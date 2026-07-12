#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::settings::BlurSettings;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlurConfig {
    pub name: String,
    pub description: String,
    pub is_preset: bool,
    pub settings: BlurSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigInfo {
    pub name: String,
    pub description: String,
    pub is_preset: bool,
}

fn configs_dir() -> Result<PathBuf, String> {
    let docs_dir = dirs::document_dir().ok_or("Cannot determine Documents directory")?;
    let app_dir = docs_dir.join("Convert-Blur-Configs");
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(app_dir)
}

fn config_path(name: &str) -> Result<PathBuf, String> {
    let dir = configs_dir()?;
    let safe_name = name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    Ok(dir.join(format!("{}.json", safe_name)))
}

pub fn save_config(name: &str, description: &str, settings: &BlurSettings) -> Result<(), String> {
    let config = BlurConfig {
        name: name.to_string(),
        description: description.to_string(),
        is_preset: false,
        settings: settings.clone(),
    };

    let path = config_path(name)?;
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&path, json).map_err(|e| format!("Failed to write config file: {}", e))?;
    Ok(())
}

pub fn load_config(name: &str) -> Result<BlurConfig, String> {
    let path = config_path(name)?;
    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    serde_json::from_str(&data).map_err(|e| format!("Failed to parse config file: {}", e))
}

pub fn delete_config(name: &str) -> Result<(), String> {
    let path = config_path(name)?;
    if !path.exists() {
        return Err(format!("Config '{}' not found", name));
    }
    fs::remove_file(&path).map_err(|e| format!("Failed to delete config file: {}", e))
}

pub fn list_configs() -> Result<Vec<ConfigInfo>, String> {
    let dir = configs_dir()?;
    let mut configs = Vec::new();

    // Load built-in presets first
    for preset in get_preset_configs() {
        configs.push(ConfigInfo {
            name: preset.name.clone(),
            description: preset.description.clone(),
            is_preset: true,
        });
    }

    // Load user configs
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(data) = fs::read_to_string(&path) {
                    if let Ok(config) = serde_json::from_str::<BlurConfig>(&data) {
                        if !config.is_preset {
                            configs.push(ConfigInfo {
                                name: config.name,
                                description: config.description,
                                is_preset: false,
                            });
                        }
                    }
                }
            }
        }
    }

    configs.sort_by(|a, b| a.is_preset.cmp(&b.is_preset).then_with(|| a.name.cmp(&b.name)));
    Ok(configs)
}

pub fn get_preset_configs() -> Vec<BlurConfig> {
    vec![
        BlurConfig {
            name: "Cinematic Blur".to_string(),
            description: "Subtle 24fps cinematic motion blur with gaussian weighting".to_string(),
            is_preset: true,
            settings: BlurSettings {
                blur: true,
                blur_amount: 1.0,
                blur_output_fps: 60,
                blur_weighting: "gaussian".to_string(),
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
                quality: 18,
                gpu_decoding: true,
                gpu_interpolation: true,
                gpu_encoding: false,
                detailed_filenames: false,
                copy_dates: false,
                override_advanced: false,
                advanced: Default::default(),
            },
        },
        BlurConfig {
            name: "Subtle Smooth".to_string(),
            description: "Light motion blur for a smooth, film-like look".to_string(),
            is_preset: true,
            settings: BlurSettings {
                blur: true,
                blur_amount: 0.5,
                blur_output_fps: 60,
                blur_weighting: "equal".to_string(),
                blur_gamma: 1.0,
                interpolate: true,
                interpolated_fps: "600".to_string(),
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
                quality: 20,
                gpu_decoding: true,
                gpu_interpolation: true,
                gpu_encoding: false,
                detailed_filenames: false,
                copy_dates: false,
                override_advanced: false,
                advanced: Default::default(),
            },
        },
        BlurConfig {
            name: "Heavy Blur".to_string(),
            description: "Maximum motion blur for dream-like sequences".to_string(),
            is_preset: true,
            settings: BlurSettings {
                blur: true,
                blur_amount: 2.0,
                blur_output_fps: 120,
                blur_weighting: "gaussian_sym".to_string(),
                blur_gamma: 1.5,
                interpolate: true,
                interpolated_fps: "2400".to_string(),
                interpolation_method: "svp".to_string(),
                pre_interpolate: true,
                pre_interpolated_fps: "480".to_string(),
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
                advanced: Default::default(),
            },
        },
        BlurConfig {
            name: "Upscale 60fps".to_string(),
            description: "No blur, just interpolate to 60fps".to_string(),
            is_preset: true,
            settings: BlurSettings {
                blur: false,
                blur_amount: 1.0,
                blur_output_fps: 60,
                blur_weighting: "equal".to_string(),
                blur_gamma: 1.0,
                interpolate: true,
                interpolated_fps: "60".to_string(),
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
                quality: 18,
                gpu_decoding: true,
                gpu_interpolation: true,
                gpu_encoding: false,
                detailed_filenames: false,
                copy_dates: false,
                override_advanced: false,
                advanced: Default::default(),
            },
        },
        BlurConfig {
            name: "Vegas Style".to_string(),
            description: "Strong motion blur with vegas weighting for stylized look".to_string(),
            is_preset: true,
            settings: BlurSettings {
                blur: true,
                blur_amount: 1.5,
                blur_output_fps: 90,
                blur_weighting: "vegas".to_string(),
                blur_gamma: 1.2,
                interpolate: true,
                interpolated_fps: "1800".to_string(),
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
                advanced: Default::default(),
            },
        },
    ]
}
