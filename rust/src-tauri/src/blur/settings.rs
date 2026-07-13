#![allow(dead_code)]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedSettings {
    pub video_container: String,
    pub deduplicate_range: i32,
    pub deduplicate_threshold: String,
    pub ffmpeg_override: String,
    pub debug: bool,
    pub blur_weighting_gaussian_std_dev: f64,
    pub blur_weighting_gaussian_mean: f64,
    pub blur_weighting_gaussian_bound: String,
    pub svp_interpolation_preset: String,
    pub svp_interpolation_algorithm: String,
    pub interpolation_blocksize: String,
    pub interpolation_mask_area: i32,
    pub rife_model: String,
    pub manual_svp: bool,
    pub super_string: String,
    pub vectors_string: String,
    pub smooth_string: String,
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            video_container: "mp4".to_string(),
            deduplicate_range: 2,
            deduplicate_threshold: "0.001".to_string(),
            ffmpeg_override: String::new(),
            debug: false,
            blur_weighting_gaussian_std_dev: 1.0,
            blur_weighting_gaussian_mean: 2.0,
            blur_weighting_gaussian_bound: "[0,2]".to_string(),
            svp_interpolation_preset: "weak".to_string(),
            svp_interpolation_algorithm: "13".to_string(),
            interpolation_blocksize: "8".to_string(),
            interpolation_mask_area: 0,
            rife_model: "rife-v4.26_ensembleFalse".to_string(),
            manual_svp: false,
            super_string: String::new(),
            vectors_string: String::new(),
            smooth_string: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlurSettings {
    pub blur: bool,
    pub blur_amount: f64,
    pub blur_output_fps: i32,
    pub blur_weighting: String,
    pub blur_gamma: f64,

    pub interpolate: bool,
    pub interpolated_fps: String,
    pub interpolation_method: String,

    pub pre_interpolate: bool,
    pub pre_interpolated_fps: String,

    pub deduplicate: bool,
    pub deduplicate_method: String,

    pub timescale: bool,
    pub input_timescale: f64,
    pub output_timescale: f64,
    pub output_timescale_audio_pitch: bool,

    pub filters: bool,
    pub brightness: f64,
    pub saturation: f64,
    pub contrast: f64,

    pub encode_preset: String,
    pub quality: i32,

    pub gpu_decoding: bool,
    pub gpu_interpolation: bool,
    pub gpu_encoding: bool,

    pub detailed_filenames: bool,
    #[serde(default)]
    pub copy_dates: bool,

    pub override_advanced: bool,
    pub advanced: AdvancedSettings,
}

impl Default for BlurSettings {
    fn default() -> Self {
        Self {
            blur: true,
            blur_amount: 1.0,
            blur_output_fps: 60,
            blur_weighting: "equal".to_string(),
            blur_gamma: 1.0,

            interpolate: true,
            interpolated_fps: "1200".to_string(),
            interpolation_method: "svp".to_string(),

            pre_interpolate: false,
            pre_interpolated_fps: "360".to_string(),

            deduplicate: true,
            deduplicate_method: "svp".to_string(),

            timescale: false,
            input_timescale: 1.0,
            output_timescale: 1.0,
            output_timescale_audio_pitch: false,

            filters: false,
            brightness: 1.0,
            saturation: 1.0,
            contrast: 1.0,

            encode_preset: "h264".to_string(),
            quality: 16,

            gpu_decoding: true,
            gpu_interpolation: true,
            gpu_encoding: false,

            detailed_filenames: false,
            copy_dates: false,

            override_advanced: false,
            advanced: AdvancedSettings::default(),
        }
    }
}

impl BlurSettings {
    pub fn to_json_value(&self) -> serde_json::Value {
        let mut j = serde_json::json!({
            "blur": self.blur,
            "blur_amount": self.blur_amount,
            "blur_output_fps": self.blur_output_fps,
            "blur_weighting": self.blur_weighting,
            "blur_gamma": self.blur_gamma,

            "interpolate": self.interpolate,
            "interpolated_fps": self.interpolated_fps,
            "interpolation_method": self.interpolation_method,

            "pre_interpolate": self.pre_interpolate,
            "pre_interpolated_fps": self.pre_interpolated_fps,

            "deduplicate": self.deduplicate,
            "deduplicate_method": self.deduplicate_method,

            "timescale": self.timescale,
            "input_timescale": self.input_timescale,
            "output_timescale": self.output_timescale,
            "output_timescale_audio_pitch": self.output_timescale_audio_pitch,

            "filters": self.filters,
            "brightness": self.brightness,
            "saturation": self.saturation,
            "contrast": self.contrast,

            "encode_preset": self.encode_preset,
            "quality": self.quality,

            "gpu_decoding": self.gpu_decoding,
            "gpu_interpolation": self.gpu_interpolation,
            "gpu_encoding": self.gpu_encoding,

            "detailed_filenames": self.detailed_filenames,
            "copy_dates": self.copy_dates,

            "override_advanced": self.override_advanced,
            "video_container": self.advanced.video_container,

            "deduplicate_range": self.advanced.deduplicate_range,
            "deduplicate_threshold": self.advanced.deduplicate_threshold,
            "debug": self.advanced.debug,

            "blur_weighting_gaussian_std_dev": self.advanced.blur_weighting_gaussian_std_dev,
            "blur_weighting_gaussian_mean": self.advanced.blur_weighting_gaussian_mean,
            "blur_weighting_gaussian_bound": self.advanced.blur_weighting_gaussian_bound,

            "svp_interpolation_preset": self.advanced.svp_interpolation_preset,
            "svp_interpolation_algorithm": self.advanced.svp_interpolation_algorithm,
            "interpolation_blocksize": self.advanced.interpolation_blocksize,
            "interpolation_mask_area": self.advanced.interpolation_mask_area,

            "rife_model": self.advanced.rife_model,

            "manual_svp": self.advanced.manual_svp,
            "super_string": self.advanced.super_string,
            "vectors_string": self.advanced.vectors_string,
            "smooth_string": self.advanced.smooth_string,
        });

        if !self.advanced.ffmpeg_override.is_empty() {
            j["ffmpeg_override"] = serde_json::json!(self.advanced.ffmpeg_override);
        }

        j
    }

    pub fn parse_fps_string(s: &str) -> Option<f64> {
        let s = s.trim();
        if let Some(multiplier) = s.strip_suffix('x') {
            multiplier.parse::<f64>().ok()
        } else {
            s.parse::<f64>().ok()
        }
    }
}

pub const SVP_INTERPOLATION_PRESETS: &[&str] = &[
    "weak", "film", "smooth", "animation", "default", "test",
];

pub const SVP_INTERPOLATION_ALGORITHMS: &[&str] = &[
    "1", "2", "11", "13", "21", "23",
];

pub const INTERPOLATION_BLOCK_SIZES: &[&str] = &["4", "8", "16", "32"];

pub const WEIGHTING_OPTIONS: &[&str] = &[
    "equal",
    "ascending",
    "descending",
    "pyramid",
    "gaussian",
    "gaussian_reverse",
    "gaussian_sym",
    "vegas",
];

pub const VIDEO_CONTAINERS: &[&str] = &["mp4", "mkv", "avi", "mov", "webm"];
