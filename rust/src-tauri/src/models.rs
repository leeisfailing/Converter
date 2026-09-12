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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfoResponse {
    pub ok: bool,
    pub has_video_stream: bool,
    pub fps_num: i32,
    pub fps_den: i32,
    pub duration: f64,
    pub color_range: Option<String>,
    pub pix_fmt: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub sample_rate: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightPreviewResponse {
    pub ok: bool,
    pub weights: Vec<f64>,
    pub labels: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetInfo {
    pub name: String,
    pub codec: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetListResponse {
    pub ok: bool,
    pub presets: Vec<PresetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityConfigResponse {
    pub ok: bool,
    pub min_quality: i32,
    pub max_quality: i32,
    pub quality_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfoResponse {
    pub ok: bool,
    pub gpu_type: String,
    pub has_hardware_encoder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigInfoResponse {
    pub name: String,
    pub description: String,
    pub is_preset: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigListResponse {
    pub ok: bool,
    pub configs: Vec<ConfigInfoResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigLoadResponse {
    pub ok: bool,
    pub settings: Option<serde_json::Value>,
    pub error: Option<String>,
}

// ===== SETTINGS =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsResponse {
    pub download_dir: String,
    pub output_dir: String,
    pub auto_save: bool,
    pub overwrite_existing: bool,
}

impl From<&AppSettings> for AppSettingsResponse {
    fn from(s: &AppSettings) -> Self {
        Self {
            download_dir: s.download_dir.clone(),
            output_dir: s.output_dir.clone(),
            auto_save: s.auto_save,
            overwrite_existing: s.overwrite_existing,
        }
    }
}

