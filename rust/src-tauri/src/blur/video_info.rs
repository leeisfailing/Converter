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
    pub sample_rate: Option<i32>,
    pub fps_num: i32,
    pub fps_den: i32,
    pub duration: f64,
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
            sample_rate: None,
            fps_num: 0,
            fps_den: 1,
            duration: 0.0,
        }
    }
}

fn find_ffprobe() -> String {
    for name in &["ffprobe", "ffprobe.exe"] {
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
    "ffprobe".to_string()
}

pub fn get_video_info(path: &str) -> Result<VideoInfo, String> {
    let ffprobe = find_ffprobe();

    let output = Command::new(&ffprobe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries",
            "stream=codec_type,codec_name,duration,color_range,sample_rate,r_frame_rate,pix_fmt,color_space,color_transfer,color_primaries",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1",
            path,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

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
        } else if let Some(val) = line.strip_prefix("sample_rate=") {
            if let Ok(sr) = val.parse::<i32>() {
                info.sample_rate = Some(sr);
            }
        } else if let Some(val) = line.strip_prefix("r_frame_rate=") {
            if let Some((num_str, den_str)) = val.split_once('/') {
                if let (Ok(num), Ok(den)) = (num_str.parse::<i32>(), den_str.parse::<i32>()) {
                    if den > 0 {
                        info.fps_num = num;
                        info.fps_den = den;
                    }
                }
            }
        }
    }

    Ok(info)
}
