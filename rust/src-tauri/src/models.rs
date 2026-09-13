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
pub struct UrlFormatQuality {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlFormat {
    pub label: String,
    pub value: String,
    pub desc: String,
    #[serde(default)]
    pub qualities: Option<Vec<UrlFormatQuality>>,
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
    pub use_gpu: bool,
    pub preferred_encoder: String,
}

impl From<&AppSettings> for AppSettingsResponse {
    fn from(s: &AppSettings) -> Self {
        Self {
            download_dir: s.download_dir.clone(),
            output_dir: s.output_dir.clone(),
            use_gpu: s.use_gpu,
            preferred_encoder: s.preferred_encoder.clone(),
        }
    }
}

impl From<AppSettings> for AppSettingsResponse {
    fn from(s: AppSettings) -> Self {
        Self {
            download_dir: s.download_dir,
            output_dir: s.output_dir,
            use_gpu: s.use_gpu,
            preferred_encoder: s.preferred_encoder,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_settings_load_and_manual_encoder_roundtrips() {
        let mut settings: AppSettings = serde_json::from_value(serde_json::json!({
            "downloadDir": "downloads", "outputDir": "output", "useGpu": false
        })).unwrap();
        assert_eq!(settings.preferred_encoder, "");
        settings.preferred_encoder = "hevc_nvenc".into();
        let json = serde_json::to_value(AppSettingsResponse::from(settings)).unwrap();
        assert_eq!(json["preferredEncoder"], "hevc_nvenc");
        assert_eq!(json["useGpu"], false);
    }
}
