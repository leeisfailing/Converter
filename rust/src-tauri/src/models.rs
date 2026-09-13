use serde::{Deserialize, Serialize};
use crate::settings::AppSettings;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinishedEvent {
    pub ok: bool,
    pub message: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectFileResponse {
    pub ok: bool,
    pub file_type: String,
    pub allowed_formats: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlFormat {
    pub label: String,
    pub value: String,
    pub desc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectUrlResponse {
    pub ok: bool,
    pub title: String,
    pub duration: String,
    pub thumbnail: String,
    pub webpage_url: String,
    pub is_live: bool,
    pub formats: Vec<UrlFormat>,
    pub format_type: String,
}

// ===== SETTINGS =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsResponse {
    pub download_dir: String,
    pub output_dir: String,
}

impl From<&AppSettings> for AppSettingsResponse {
    fn from(s: &AppSettings) -> Self {
        Self {
            download_dir: s.download_dir.clone(),
            output_dir: s.output_dir.clone(),
        }
    }
}

impl From<AppSettings> for AppSettingsResponse {
    fn from(s: AppSettings) -> Self {
        Self {
            download_dir: s.download_dir,
            output_dir: s.output_dir,
        }
    }
}
