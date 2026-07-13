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
        if let Ok(mut child) = Command::new(name)
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            let _ = child.wait();
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
    let ffmpeg = find_ffmpeg();
    let output = Command::new(&ffmpeg)
        .args(["-encoders"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    let stdout = match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout).to_string(),
        Err(_) => {
            return GpuInfo {
                gpu_type: "cpu".to_string(),
                has_hardware_encoder: false,
            };
        }
    };

    // Check any hardware encoder per GPU type, not just h264
    let nvidia_encoders = ["h264_nvenc", "hevc_nvenc", "av1_nvenc"];
    let amd_encoders = ["h264_amf", "hevc_amf", "av1_amf"];
    let intel_encoders = ["h264_qsv", "hevc_qsv", "av1_qsv"];
    let mac_encoders = ["h264_videotoolbox", "hevc_videotoolbox", "av1_videotoolbox"];

    if nvidia_encoders.iter().any(|e| stdout.contains(e)) {
        return GpuInfo {
            gpu_type: "nvidia".to_string(),
            has_hardware_encoder: true,
        };
    }
    if amd_encoders.iter().any(|e| stdout.contains(e)) {
        return GpuInfo {
            gpu_type: "amd".to_string(),
            has_hardware_encoder: true,
        };
    }
    if intel_encoders.iter().any(|e| stdout.contains(e)) {
        return GpuInfo {
            gpu_type: "intel".to_string(),
            has_hardware_encoder: true,
        };
    }
    if mac_encoders.iter().any(|e| stdout.contains(e)) {
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
                "libx264", "libx265", "libaom-av1", "libvpx-vp9",
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
