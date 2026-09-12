use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub has_video_stream: bool,
    pub color_range: Option<String>,
    pub pix_fmt: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub fps_num: i32,
    pub fps_den: i32,
    pub duration: f64,
    pub sample_rate: Option<i32>,
}

impl Default for VideoInfo {
    fn default() -> Self {
        Self {
            has_video_stream: false,
            color_range: None,
            pix_fmt: None,
            color_space: None,
            color_transfer: None,
            color_primaries: None,
            fps_num: 0,
            fps_den: 1,
            duration: 0.0,
            sample_rate: None,
        }
    }
}

use crate::paths::ffprobe as find_ffprobe;

pub fn get_video_info(path: &str) -> Result<VideoInfo, String> {
    let ffprobe = find_ffprobe();

    let output = Command::new(&ffprobe)
        .args([
            "-v", "error",
            "-show_entries",
            "stream=codec_type,codec_name,duration,color_range,r_frame_rate,pix_fmt,color_space,color_transfer,color_primaries,sample_rate",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1",
            path,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = if stderr.trim().is_empty() {
            format!("ffprobe exited with status: {}", output.status)
        } else {
            format!("ffprobe error: {}", stderr.trim())
        };
        return Err(msg);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut info = VideoInfo::default();

    for line in stdout.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("codec_type=") {
            if val == "video" {
                info.has_video_stream = true;
            }
        } else if let Some(val) = line.strip_prefix("duration=") {
            if let Ok(d) = val.parse::<f64>() {
                info.duration = d;
            }
        } else if let Some(val) = line.strip_prefix("color_range=") {
            info.color_range = Some(val.to_string());
        } else if let Some(val) = line.strip_prefix("pix_fmt=") {
            info.pix_fmt = Some(val.to_string());
        } else if let Some(val) = line.strip_prefix("color_space=") {
            info.color_space = Some(val.to_string());
        } else if let Some(val) = line.strip_prefix("color_transfer=") {
            info.color_transfer = Some(val.to_string());
        } else if let Some(val) = line.strip_prefix("color_primaries=") {
            info.color_primaries = Some(val.to_string());
        } else if let Some(val) = line.strip_prefix("r_frame_rate=") {
            if let Some((num_str, den_str)) = val.split_once('/') {
                if let (Ok(num), Ok(den)) = (num_str.parse::<i32>(), den_str.parse::<i32>()) {
                    if den > 0 && num >= 0 {
                        info.fps_num = num;
                        info.fps_den = den;
                    }
                }
            }
        } else if let Some(val) = line.strip_prefix("sample_rate=") {
            if let Ok(sr) = val.parse::<i32>() {
                info.sample_rate = Some(sr);
            }
        }
    }

    Ok(info)
}
