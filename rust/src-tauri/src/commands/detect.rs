use crate::{cache::AppCache, engine, cpp_engine, models::*, validation};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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

#[tauri::command]
pub async fn detect_file(app: AppHandle, path: String, dev_mode: bool) -> Result<DetectFileResponse, String> {
    validation::validate_file_exists(&path, "path")?;

    // Check persistent cache (keyed by path + size + mtime)
    let (size, mtime) = std::fs::metadata(&path)
        .ok()
        .map(|m| (Some(m.len()), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs()))))
        .unwrap_or((None, None));
    let cache_key = format!("detect:{path}");
    let pc = crate::persistent_cache::PersistentCache::global();
    if let Some(cached) = pc.get_file(&cache_key, size, mtime).await {
        return serde_json::from_value(cached).map_err(|e| e.to_string());
    }

    let req = DetectFileRequest { cmd: "detect_file", path: &path, dev_mode };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    let response: DetectFileResponse = engine::request(&app, cmd_json).await?;

    // Cache the result
    if let Ok(val) = serde_json::to_value(&response) {
        pc.set_file(&cache_key, val, size, mtime).await;
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
    let req = DetectGpuRequest { cmd: "detect_gpu" };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    let response: GpuInfo = if cpp_engine::binary_path().is_some() {
        cpp_engine::request(&app, cmd_json).await?
    } else {
        engine::request(&app, cmd_json).await?
    };
    cache.set_gpu("default".into(), response.clone()).await;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
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
