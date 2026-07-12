#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub gpu_type: String,
    pub has_hardware_encoder: bool,
}

fn find_ffmpeg() -> String {
    for name in &["ffmpeg", "ffmpeg.exe"] {
        if Command::new(name)
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .is_ok()
        {
            return name.to_string();
        }
    }
    "ffmpeg".to_string()
}

fn check_encoder(encoder_name: &str) -> bool {
    let ffmpeg = find_ffmpeg();
    let output = Command::new(&ffmpeg)
        .args(["-encoders"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.contains(encoder_name)
        }
        Err(_) => false,
    }
}

pub fn detect_gpu_type() -> GpuInfo {
    if check_encoder("h264_nvenc") {
        return GpuInfo {
            gpu_type: "nvidia".to_string(),
            has_hardware_encoder: true,
        };
    }
    if check_encoder("h264_amf") {
        return GpuInfo {
            gpu_type: "amd".to_string(),
            has_hardware_encoder: true,
        };
    }
    if check_encoder("h264_qsv") {
        return GpuInfo {
            gpu_type: "intel".to_string(),
            has_hardware_encoder: true,
        };
    }
    if check_encoder("h264_videotoolbox") {
        return GpuInfo {
            gpu_type: "mac".to_string(),
            has_hardware_encoder: true,
        };
    }

    GpuInfo {
        gpu_type: "cpu".to_string(),
        has_hardware_encoder: false,
    }
}

pub fn get_available_encoders() -> Vec<String> {
    let ffmpeg = find_ffmpeg();
    let output = Command::new(&ffmpeg)
        .args(["-encoders"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let encoders = [
                "h264_nvenc", "hevc_nvenc", "av1_nvenc",
                "h264_amf", "hevc_amf", "av1_amf",
                "h264_qsv", "hevc_qsv", "av1_qsv",
                "h264_videotoolbox", "hevc_videotoolbox", "av1_videotoolbox",
            ];
            encoders
                .iter()
                .filter(|e| stdout.contains(*e))
                .map(|e| e.to_string())
                .collect()
        }
        Err(_) => vec![],
    }
}
