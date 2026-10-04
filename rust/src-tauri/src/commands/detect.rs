use crate::{cache::AppCache, engine, cpp_engine, models::*, validation};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use std::{collections::HashMap, sync::{Arc, Mutex, OnceLock, Weak}};

// Share an in-flight lookup without serializing unrelated files. Weak entries
// let completed requests release their lock and keep the registry bounded.
pub(crate) fn file_cache_lock(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner());
    if let Some(lock) = locks.get(key).and_then(Weak::upgrade) { return lock; }
    if locks.len() >= 128 { locks.retain(|_, lock| lock.strong_count() > 0); }
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(key.to_owned(), Arc::downgrade(&lock));
    lock
}

pub(crate) fn file_signature(path: &str) -> Option<(u64, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some((metadata.len(), u64::try_from(modified.as_nanos()).ok()?))
}

#[derive(Serialize)]
struct DetectFileRequest<'a> {
    cmd: &'static str,
    path: &'a str,
    dev_mode: bool,
}

#[derive(Serialize)]
struct DetectUrlRequest<'a> {
    cmd: &'static str,
    url: &'a str,
}

#[derive(Serialize)]
struct DetectGpuRequest {
    cmd: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncoderInfo {
    pub id: String,
    pub vendor: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub ok: bool,
    pub available: bool,
    pub encoder: Option<String>,
    pub vendor: Option<String>,
    pub hwaccel: Option<String>,
    pub name: Option<String>,
    pub message: String,
    #[serde(default, alias = "all_encoders")]
    pub all_encoders: Vec<EncoderInfo>,
}

fn detection_cache_key(path: &str, dev_mode: bool) -> String {
    format!("detect-v2:{dev_mode}:{path}")
}

#[tauri::command]
pub async fn detect_file(app: AppHandle, path: String, dev_mode: bool) -> Result<DetectFileResponse, String> {
    validation::validate_file_exists(&path, "path")?;

    // Check persistent cache (keyed by path + size + mtime)
    let cache_key = detection_cache_key(&path, dev_mode);
    let lock = file_cache_lock(&cache_key);
    let _guard = lock.lock().await;
    let signature = file_signature(&path);
    let (size, mtime) = signature.map(|(s, m)| (Some(s), Some(m))).unwrap_or((None, None));
    let pc = crate::persistent_cache::PersistentCache::global();
    if signature.is_some() {
        if let Some(cached) = pc.get_file(&cache_key, size, mtime).await {
            if let Ok(response) = serde_json::from_value(cached) { return Ok(response); }
        }
    }

    let req = DetectFileRequest { cmd: "detect_file", path: &path, dev_mode };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    let response: DetectFileResponse = engine::request(&app, cmd_json).await?;

    // Cache the result
    if signature.is_some() && file_signature(&path) == signature {
        if let Ok(val) = serde_json::to_value(&response) {
            pc.set_file(&cache_key, val, size, mtime).await;
        }
    }
    Ok(response)
}

#[tauri::command]
pub async fn detect_url(app: AppHandle, url: String) -> Result<DetectUrlResponse, String> {
    validation::validate_url(&url)?;
    let req = DetectUrlRequest { cmd: "detect_url", url: &url };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    engine::request(&app, cmd_json).await
}

#[tauri::command]
pub async fn detect_gpu(app: AppHandle, cache: tauri::State<'_, AppCache>) -> Result<GpuInfo, String> {
    if let Some(cached) = cache.get_gpu("default").await {
        return Ok(cached);
    }
    static GPU_PROBE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = GPU_PROBE.lock().await;
    if let Some(cached) = cache.get_gpu("default").await { return Ok(cached); }
    let req = DetectGpuRequest { cmd: "detect_gpu" };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    let response: GpuInfo = if cpp_engine::binary_path_for_app(&app).is_some() {
        cpp_engine::request(&app, cmd_json).await?
    } else {
        engine::request(&app, cmd_json).await?
    };
    // Only cache a usable probe: a transient failure must not stick for
    // `GPU_CACHE_TTL_SECS`.
    if response.ok && response.available {
        cache.set_gpu("default".into(), response.clone()).await;
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detection_cache_separates_developer_format_choices() {
        assert_ne!(detection_cache_key("video.mp4", false), detection_cache_key("video.mp4", true));
        assert_ne!(detection_cache_key("video.mp4", false), detection_cache_key("other.mp4", false));
    }
    #[test]
    fn encoder_list_crosses_python_and_frontend_naming_conventions() {
        let info: GpuInfo = serde_json::from_value(serde_json::json!({
            "ok": true, "available": true, "encoder": "h264_nvenc",
            "vendor": "NVIDIA", "hwaccel": "cuda", "name": "Test GPU", "message": "",
            "all_encoders": [{"id": "h264_nvenc", "vendor": "NVIDIA", "label": "H.264"}]
        })).unwrap();
        let response = serde_json::to_value(info).unwrap();
        assert_eq!(response["allEncoders"][0]["id"], "h264_nvenc");
    }
}
