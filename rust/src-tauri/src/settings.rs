use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Where downloads are saved (default: user's Downloads folder)
    pub download_dir: String,
    /// Where converted/compressed/blurred files go.
    /// Empty string means "same as input file".
    pub output_dir: String,
    /// When true, output files go to output_dir instead of next to input
    pub auto_save: bool,
    /// Whether to overwrite files that already exist
    pub overwrite_existing: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        let download_dir = dirs::download_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .map(|p| p.join("Downloads").to_string_lossy().to_string())
                    .unwrap_or_else(|| ".".to_string())
            });

        Self {
            download_dir,
            output_dir: String::new(),
            auto_save: false,
            overwrite_existing: false,
        }
    }
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
    Ok(defaults)
}

/// Get the user's default downloads directory
pub fn get_default_download_dir() -> String {
    AppSettings::default().download_dir
}
