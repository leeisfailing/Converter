#![allow(dead_code)]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub name: String,
    pub args: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuPresets {
    pub gpu_type: String,
    pub presets: Vec<Preset>,
}

fn default_all_presets() -> Vec<GpuPresets> {
    vec![
        GpuPresets {
            gpu_type: "nvidia".to_string(),
            presets: vec![
                Preset { name: "h264".to_string(), args: "-c:v h264_nvenc -preset p5 -rc vbr -cq {quality}".to_string() },
                Preset { name: "h265".to_string(), args: "-c:v hevc_nvenc -preset p5 -rc vbr -cq {quality}".to_string() },
                Preset { name: "av1".to_string(), args: "-c:v av1_nvenc -preset p5 -rc vbr -cq {quality}".to_string() },
            ],
        },
        GpuPresets {
            gpu_type: "amd".to_string(),
            presets: vec![
                Preset { name: "h264".to_string(), args: "-c:v h264_amf -rc cqp -qp_i {quality} -qp_p {quality} -qp_b {quality}".to_string() },
                Preset { name: "h265".to_string(), args: "-c:v hevc_amf -rc cqp -qp_i {quality} -qp_p {quality} -qp_b {quality}".to_string() },
                Preset { name: "av1".to_string(), args: "-c:v av1_amf -rc cqp -qp_i {quality} -qp_p {quality} -qp_b {quality}".to_string() },
            ],
        },
        GpuPresets {
            gpu_type: "intel".to_string(),
            presets: vec![
                Preset { name: "h264".to_string(), args: "-c:v h264_qsv -global_quality {quality} -preset veryfast".to_string() },
                Preset { name: "h265".to_string(), args: "-c:v hevc_qsv -global_quality {quality} -preset veryfast".to_string() },
                Preset { name: "av1".to_string(), args: "-c:v av1_qsv -global_quality {quality} -preset veryfast".to_string() },
            ],
        },
        GpuPresets {
            gpu_type: "mac".to_string(),
            presets: vec![
                Preset { name: "h264".to_string(), args: "-c:v h264_videotoolbox -q:v {quality}".to_string() },
                Preset { name: "h265".to_string(), args: "-c:v hevc_videotoolbox -q:v {quality}".to_string() },
                Preset { name: "av1".to_string(), args: "-c:v av1_videotoolbox -q:v {quality}".to_string() },
                Preset { name: "prores".to_string(), args: "-c:v prores_videotoolbox -profile:v {quality}".to_string() },
            ],
        },
        GpuPresets {
            gpu_type: "cpu".to_string(),
            presets: vec![
                Preset { name: "h264".to_string(), args: "-c:v libx264 -preset veryfast -crf {quality}".to_string() },
                Preset { name: "h265".to_string(), args: "-c:v libx265 -preset veryfast -crf {quality}".to_string() },
                Preset { name: "av1".to_string(), args: "-c:v libaom-av1 -cpu-used 4 -crf {quality}".to_string() },
                Preset { name: "vp9".to_string(), args: "-c:v libvpx-vp9 -deadline good -crf {quality} -b:v 0".to_string() },
            ],
        },
    ]
}

pub fn get_all_presets() -> Vec<GpuPresets> {
    default_all_presets()
}

pub fn find_preset_params(gpu_type: &str, preset_name: &str, quality: i32) -> Vec<String> {
    let all_presets = default_all_presets();

    for group in &all_presets {
        if group.gpu_type == gpu_type {
            for preset in &group.presets {
                if preset.name == preset_name {
                    let args_str = preset.args.replace("{quality}", &quality.to_string());
                    return args_str
                        .split_whitespace()
                        .map(|s| s.to_string())
                        .collect();
                }
            }
        }
    }

    // Fallback to cpu h264
    if gpu_type != "cpu" {
        return find_preset_params("cpu", preset_name, quality);
    }
    find_preset_params("cpu", "h264", quality)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetInfo {
    pub name: String,
    pub codec: String,
}

pub fn get_available_presets(gpu_type: &str) -> Vec<PresetInfo> {
    let all_presets = default_all_presets();
    let mut result = Vec::new();

    for group in &all_presets {
        if group.gpu_type == gpu_type {
            for preset in &group.presets {
                let args: Vec<&str> = preset.args.split_whitespace().collect();
                for i in 0..args.len().saturating_sub(1) {
                    if args[i] == "-c:v" || args[i] == "-codec:v" {
                        result.push(PresetInfo {
                            name: preset.name.clone(),
                            codec: args[i + 1].to_string(),
                        });
                        break;
                    }
                }
            }
        }
    }

    result
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityConfig {
    pub min_quality: i32,
    pub max_quality: i32,
    pub quality_label: String,
}

pub fn get_quality_config(codec: &str) -> QualityConfig {
    match codec {
        "h264_nvenc" | "hevc_nvenc" | "av1_nvenc" => QualityConfig {
            min_quality: 1,
            max_quality: 51,
            quality_label: "(1: best, 23: balanced, 51: worst)".to_string(),
        },
        "h264_amf" | "hevc_amf" | "av1_amf" => QualityConfig {
            min_quality: 0,
            max_quality: 51,
            quality_label: "(0: best, 23: balanced, 51: worst)".to_string(),
        },
        "h264_qsv" | "hevc_qsv" | "av1_qsv" => QualityConfig {
            min_quality: 1,
            max_quality: 51,
            quality_label: "(1: best, 23: balanced, 51: worst)".to_string(),
        },
        "h264_videotoolbox" | "hevc_videotoolbox" | "av1_videotoolbox" => QualityConfig {
            min_quality: 1,
            max_quality: 100,
            quality_label: "(100: best, 1: worst)".to_string(),
        },
        "prores_videotoolbox" => QualityConfig {
            min_quality: 0,
            max_quality: 6,
            quality_label: "(0: auto, 1: proxy, 2: lt, 3: std, 4: hq, 5: 4444, 6: 4444xq)".to_string(),
        },
        "libx264" | "libx265" => QualityConfig {
            min_quality: 0,
            max_quality: 51,
            quality_label: "(0: lossless, 23: balanced, 51: worst)".to_string(),
        },
        "libaom-av1" => QualityConfig {
            min_quality: 0,
            max_quality: 63,
            quality_label: "(0: best, 25: balanced, 63: worst)".to_string(),
        },
        "libvpx-vp9" => QualityConfig {
            min_quality: 0,
            max_quality: 63,
            quality_label: "(0: best, 30: balanced, 63: worst)".to_string(),
        },
        _ => QualityConfig {
            min_quality: 0,
            max_quality: 51,
            quality_label: String::new(),
        },
    }
}

pub fn get_preset_codec(gpu_type: &str, preset_name: &str) -> String {
    let all_presets = default_all_presets();

    for group in &all_presets {
        if group.gpu_type == gpu_type {
            for preset in &group.presets {
                if preset.name == preset_name {
                    let args: Vec<&str> = preset.args.split_whitespace().collect();
                    for i in 0..args.len().saturating_sub(1) {
                        if args[i] == "-c:v" || args[i] == "-codec:v" {
                            return args[i + 1].to_string();
                        }
                    }
                }
            }
        }
    }

    "libx264".to_string()
}
