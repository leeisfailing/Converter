use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const APP_FOLDER: &str = "Converter by Lee";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Where downloads are saved (default: ~/Documents/Converter by Lee/Downloads/)
    pub download_dir: String,
    /// Where reduced/converted files go (default: ~/Documents/Converter by Lee/Output/)
    pub output_dir: String,
    /// Use GPU hardware encoding when available (default: true)
    #[serde(default = "default_use_gpu")]
    pub use_gpu: bool,
    /// When use_gpu is false, the user can pick a specific encoder (e.g. "h264_amf").
    /// Empty string means use CPU fallback (libx264).
    #[serde(default)]
    pub preferred_encoder: String,
    /// Auto-detect GPU on startup (default: true). When false, use `selected_gpu`.
    #[serde(default = "default_true")]
    pub auto_detect_gpu: bool,
    /// User-selected GPU encoder, or "parallel" for frontend per-job GPU scheduling.
    #[serde(default)]
    pub selected_gpu: String,
}

fn default_use_gpu() -> bool {
    true
}

fn default_true() -> bool {
    true
}

fn app_base_dir() -> PathBuf {
    dirs::document_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join(APP_FOLDER)
}

impl Default for AppSettings {
    fn default() -> Self {
        let base = app_base_dir();
        let download_dir = base.join("Downloads").to_string_lossy().into_owned();
        let output_dir = base.join("Output").to_string_lossy().into_owned();
        Self {
            download_dir,
            output_dir,
            use_gpu: true,
            preferred_encoder: String::new(),
            auto_detect_gpu: true,
            selected_gpu: String::new(),
        }
    }
}

pub fn ensure_default_dirs(settings: &AppSettings) -> Result<(), String> {
    fs::create_dir_all(&settings.download_dir)
        .map_err(|e| format!("Failed to create download directory: {e}"))?;
    fs::create_dir_all(&settings.output_dir)
        .map_err(|e| format!("Failed to create output directory: {e}"))?;
    Ok(())
}

fn settings_dir() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir().ok_or("Cannot determine config directory")?;
    Ok(config_dir.join("Converter"))
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(settings_dir()?.join("settings.json"))
}

fn ensure_settings_path() -> Result<PathBuf, String> {
    let app_dir = settings_dir()?;
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(app_dir.join("settings.json"))
}

pub fn load_settings() -> Result<AppSettings, String> {
    let path = settings_path()?;
    let data = match fs::read_to_string(&path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AppSettings::default());
        }
        Err(e) => return Err(format!("Failed to read settings file: {}", e)),
    };
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse settings file: {}", e))
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = ensure_settings_path()?;
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;

    fs::rename(&tmp_path, &path)
        .or_else(|_| {
            let _ = fs::remove_file(&path);
            fs::rename(&tmp_path, &path)
        })
        .map_err(|e| format!("Failed to atomically replace settings file: {}", e))
}

pub fn reset_settings() -> Result<AppSettings, String> {
    let defaults = AppSettings::default();
    save_settings(&defaults)?;
    ensure_default_dirs(&defaults)?;
    Ok(defaults)
}

pub fn get_default_download_dir() -> String {
    app_base_dir().join("Downloads").to_string_lossy().into_owned()
}

pub fn get_default_output_dir() -> String {
    app_base_dir().join("Output").to_string_lossy().into_owned()
}
