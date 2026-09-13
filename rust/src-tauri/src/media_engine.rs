//! High-performance native media engine — replaces Python subprocess overhead.
//!
//! Calls ffmpeg directly via tokio async process management with zero-copy
//! streaming, real-time progress parsing, and GPU-accelerated pipelines.
use crate::{models::FinishedEvent, operations::Operation, paths};
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, path::Path, process::Stdio, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::Semaphore,
};

// ── Configuration ──────────────────────────────────────────────────────────

const PROGRESS_THROTTLE_MS: u64 = 100;
const MAX_STDERR_LINES: usize = 128;
const MAX_LINE_LENGTH: usize = 4096;
const DEFAULT_MAX_CONCURRENT: usize = 4;

// ── Public types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaRequest {
    #[serde(default)]
    pub cmd: String,
    #[serde(default)]
    pub input: String,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub quality: Option<u8>,
    #[serde(default)]
    pub target_bytes: Option<u64>,
    #[serde(default)]
    pub max_width: Option<u32>,
    #[serde(default)]
    pub file_type: Option<String>,
    #[serde(default)]
    pub dev_mode: Option<bool>,
    #[serde(default)]
    pub use_gpu: Option<bool>,
    #[serde(default)]
    pub preferred_encoder: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub format_type: Option<String>,
    #[serde(default)]
    pub output_dir: Option<String>,
}

impl Default for MediaRequest {
    fn default() -> Self {
        Self {
            cmd: String::new(),
            input: String::new(),
            output: String::new(),
            format: None,
            quality: None,
            target_bytes: None,
            max_width: None,
            file_type: None,
            dev_mode: None,
            use_gpu: None,
            preferred_encoder: None,
            url: None,
            format_type: None,
            output_dir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub format_name: Option<String>,
    pub bitrate: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuCapability {
    pub encoder: String,
    pub vendor: String,
    pub hwaccel: String,
    pub label: String,
    pub works: bool,
}

// ── Parallel pipeline ──────────────────────────────────────────────────────

static CONCURRENCY: Semaphore = Semaphore::const_new(DEFAULT_MAX_CONCURRENT);

/// Run a closure for each item with bounded parallelism.
pub async fn parallel_map<
    T: Send + 'static,
    F: Fn(T) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = ()> + Send,
>(
    items: Vec<T>,
    f: F,
) {
    let f = Arc::new(f);
    let mut handles = Vec::with_capacity(items.len());
    for item in items {
        let permit = CONCURRENCY.acquire().await.expect("semaphore closed");
        let f = f.clone();
        handles.push(tokio::spawn(async move {
            f(item).await;
            drop(permit);
        }));
    }
    for h in handles {
        let _ = h.await;
    }
}

// ── Native engine ──────────────────────────────────────────────────────────

pub struct NativeEngine;

impl NativeEngine {
    /// Probe a media file and return metadata.
    pub async fn probe(input: &str) -> Result<ProbeInfo, String> {
        let output = Command::new(paths::ffprobe())
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,codec_name,width,height:format=format_name,duration,bit_rate",
                "-of",
                "json",
                input,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .output()
            .await
            .map_err(|e| format!("ffprobe failed: {e}"))?;

        let info: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Invalid ffprobe output: {e}"))?;

        let format = info.get("format");
        let streams = info
            .get("streams")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let video = streams.iter().find(|s| {
            s.get("codec_type")
                .and_then(|v| v.as_str())
                == Some("video")
        });
        let audio = streams.iter().find(|s| {
            s.get("codec_type")
                .and_then(|v| v.as_str())
                == Some("audio")
        });

        Ok(ProbeInfo {
            width: video
                .and_then(|v| v.get("width").and_then(|v| v.as_u64()))
                .map(|v| v as u32),
            height: video
                .and_then(|v| v.get("height").and_then(|v| v.as_u64()))
                .map(|v| v as u32),
            duration: format
                .and_then(|v| v.get("duration").and_then(|v| v.as_str()))
                .and_then(|s| s.parse().ok()),
            vcodec: video
                .and_then(|v| v.get("codec_name").and_then(|v| v.as_str()))
                .map(String::from),
            acodec: audio
                .and_then(|v| v.get("codec_name").and_then(|v| v.as_str()))
                .map(String::from),
            format_name: format
                .and_then(|v| v.get("format_name").and_then(|v| v.as_str()))
                .map(String::from),
            bitrate: format
                .and_then(|v| v.get("bit_rate").and_then(|v| v.as_str()))
                .and_then(|s| s.parse().ok()),
        })
    }

    /// Detect available GPU encoders by probing ffmpeg.
    pub async fn detect_gpus() -> Result<Vec<GpuCapability>, String> {
        let output = Command::new(paths::ffmpeg())
            .args(["-hide_banner", "-encoders"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .output()
            .await
            .map_err(|e| format!("ffmpeg failed: {e}"))?;

        let text = String::from_utf8_lossy(&output.stdout);
        let mut caps = Vec::new();

        let hw_encoders: &[(&str, &str, &str, &str)] = &[
            ("h264_nvenc", "NVIDIA", "cuda", "NVIDIA NVENC H.264"),
            ("hevc_nvenc", "NVIDIA", "cuda", "NVIDIA NVENC HEVC"),
            ("av1_nvenc", "NVIDIA", "cuda", "NVIDIA NVENC AV1"),
            ("h264_amf", "AMD", "amf", "AMD AMF H.264"),
            ("hevc_amf", "AMD", "amf", "AMD AMF HEVC"),
            ("av1_amf", "AMD", "amf", "AMD AMF AV1"),
            ("h264_qsv", "Intel", "qsv", "Intel Quick Sync H.264"),
            ("hevc_qsv", "Intel", "qsv", "Intel Quick Sync HEVC"),
            ("av1_qsv", "Intel", "qsv", "Intel Quick Sync AV1"),
        ];

        for &(enc, vendor, hwaccel, label) in hw_encoders {
            if text.contains(enc) {
                let works = Self::test_encoder(enc).await;
                caps.push(GpuCapability {
                    encoder: enc.to_string(),
                    vendor: vendor.to_string(),
                    hwaccel: hwaccel.to_string(),
                    label: label.to_string(),
                    works,
                });
            }
        }
        Ok(caps)
    }

    async fn test_encoder(encoder: &str) -> bool {
        Command::new(paths::ffmpeg())
            .args([
                "-v", "error", "-nostdin", "-f", "lavfi", "-i",
                "color=c=black:s=256x256:r=1:d=0.1", "-frames:v", "1", "-c:v",
                encoder, "-pix_fmt", "yuv420p", "-f", "null", "-",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Run an ffmpeg command with real-time progress streaming.
    pub async fn run_ffmpeg(
        app: AppHandle,
        args: Vec<String>,
        prefix: &str,
        operation: Arc<Operation>,
    ) -> Result<(), String> {
        let progress_event = format!("{prefix}-progress");
        let finished_event = format!("{prefix}-finished");

        let mut child = Command::new(paths::ffmpeg())
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;

        let stderr = child.stderr.take().ok_or("Missing ffmpeg stderr")?;
        let mut stderr_lines = BufReader::new(stderr).lines();
        let mut stderr_tail = VecDeque::with_capacity(MAX_STDERR_LINES);
        let mut last_progress_time = std::time::Instant::now();

        let result = loop {
            if operation.is_cancelled() {
                let _ = child.kill().await;
                break Err("Operation was cancelled".into());
            }

            match tokio::time::timeout(
                Duration::from_millis(50),
                stderr_lines.next_line(),
            )
            .await
            {
                Ok(Ok(Some(line))) => {
                    if stderr_tail.len() == MAX_STDERR_LINES {
                        stderr_tail.pop_front();
                    }
                    let truncated = if line.len() > MAX_LINE_LENGTH {
                        let end = line.floor_char_boundary(MAX_LINE_LENGTH);
                        line[..end].to_string()
                    } else {
                        line.clone()
                    };
                    stderr_tail.push_back(truncated);

                    if line.contains("frame=") && line.contains("time=") {
                        if let Some(time_str) = line.split("time=").nth(1) {
                            let time_str: String =
                                time_str.chars().take_while(|c| *c != ' ').collect();
                            if let Some(seconds) = parse_hhmmss(&time_str) {
                                let now = std::time::Instant::now();
                                if now.duration_since(last_progress_time)
                                    >= Duration::from_millis(PROGRESS_THROTTLE_MS)
                                {
                                    let _ =
                                        app.emit(&progress_event, seconds as f64);
                                    last_progress_time = now;
                                }
                            }
                        }
                    }
                }
                Ok(Ok(None)) => {
                    match tokio::time::timeout(
                        Duration::from_secs(10),
                        child.wait(),
                    )
                    .await
                    {
                        Ok(Ok(status)) => {
                            if status.success() {
                                let _ = app.emit(&progress_event, 100i32);
                                break Ok(());
                            } else {
                                let errs = stderr_tail
                                    .iter()
                                    .cloned()
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                break Err(format!(
                                    "ffmpeg failed (exit {}): {}",
                                    status.code().unwrap_or(-1),
                                    errs
                                ));
                            }
                        }
                        Ok(Err(e)) => {
                            break Err(format!("ffmpeg error: {e}"));
                        }
                        Err(_) => {
                            break Err(
                                "ffmpeg timed out after stderr closed".into()
                            );
                        }
                    }
                }
                Ok(Err(e)) => {
                    break Err(format!("ffmpeg stderr read error: {e}"));
                }
                Err(_timeout) => match child.try_wait() {
                    Ok(Some(status)) => {
                        while let Ok(Some(line)) =
                            stderr_lines.next_line().await
                        {
                            if stderr_tail.len() == MAX_STDERR_LINES {
                                stderr_tail.pop_front();
                            }
                            stderr_tail.push_back(line);
                        }
                        if status.success() {
                            let _ = app.emit(&progress_event, 100i32);
                            break Ok(());
                        } else {
                            let errs = stderr_tail
                                .iter()
                                .cloned()
                                .collect::<Vec<_>>()
                                .join("\n");
                            break Err(format!(
                                "ffmpeg failed (exit {}): {}",
                                status.code().unwrap_or(-1),
                                errs
                            ));
                        }
                    }
                    Ok(None) => continue,
                    Err(e) => {
                        break Err(format!("ffmpeg wait error: {e}"));
                    }
                },
            }
        };

        let stderr_text =
            stderr_tail.iter().cloned().collect::<Vec<_>>().join("\n");
        let finished = match &result {
            Ok(()) => FinishedEvent {
                ok: true,
                message: String::new(),
                file_path: String::new(),
            },
            Err(message) => FinishedEvent {
                ok: false,
                message: if stderr_text.is_empty() {
                    message.clone()
                } else {
                    format!("{message}\n{stderr_text}")
                },
                file_path: String::new(),
            },
        };

        let _ = app.emit(&finished_event, &finished);
        result
    }

    /// Build the full ffmpeg argument list for a convert operation.
    pub async fn build_convert_args(
        req: &MediaRequest,
    ) -> Result<Vec<String>, String> {
        let input = &req.input;
        let output = &req.output;
        let format = req.format.as_deref().unwrap_or("");
        let use_gpu = req.use_gpu.unwrap_or(true);
        let preferred = req.preferred_encoder.as_deref().unwrap_or("");
        let dev_mode = req.dev_mode.unwrap_or(false);
        let max_width = req.max_width;

        let mut args = vec!["-hide_banner".into(), "-y".into(), "-nostdin".into()];

        if use_gpu {
            let encoder =
                Self::pick_encoder(preferred, format, use_gpu).await;
            if encoder.ends_with("_nvenc") {
                args.extend([
                    "-hwaccel".into(),
                    "cuda".into(),
                    "-hwaccel_output_format".into(),
                    "cuda".into(),
                ]);
            } else {
                args.extend(["-hwaccel".into(), "auto".into()]);
            }
        }

        args.extend(["-i".into(), input.into()]);

        let probe = Self::probe(input).await.ok();

        let is_audio_only =
            matches!(format, "mp3" | "aac" | "wav" | "flac" | "ogg" | "opus" | "wma");

        if is_audio_only {
            args.extend(["-vn".into()]);
            match format {
                "mp3" => args.extend([
                    "-c:a".into(),
                    "libmp3lame".into(),
                    "-b:a".into(),
                    "192k".into(),
                ]),
                "aac" => args.extend([
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                ]),
                "flac" => args.extend(["-c:a".into(), "flac".into()]),
                "opus" => args.extend([
                    "-c:a".into(),
                    "opus".into(),
                    "-b:a".into(),
                    "128k".into(),
                ]),
                "wav" => args.extend(["-c:a".into(), "pcm_s16le".into()]),
                "wma" => args.extend([
                    "-c:a".into(),
                    "wmav2".into(),
                    "-b:a".into(),
                    "192k".into(),
                ]),
                _ => args.extend(["-c:a".into(), "copy".into()]),
            }
        } else {
            let encoder =
                Self::pick_encoder(preferred, format, use_gpu).await;

            let can_copy = probe.as_ref().is_some_and(|p| {
                matches!(
                    p.vcodec.as_deref(),
                    Some("h264" | "hevc" | "av1" | "vp9")
                ) && encoder.starts_with(
                    &p.vcodec
                        .as_deref()
                        .unwrap_or("")
                        .replace("lib", ""),
                )
            });

            if can_copy {
                args.extend(["-c:v".into(), "copy".into()]);
                if probe.as_ref().and_then(|p| p.acodec.as_ref()).is_some() {
                    args.extend(["-c:a".into(), "copy".into()]);
                } else {
                    args.push("-an".into());
                }
            } else {
                if let (Some(w), Some(mw)) =
                    (probe.as_ref().and_then(|p| p.width), max_width)
                {
                    if w > mw {
                        if encoder.ends_with("_nvenc") {
                            let target_w = (mw / 2) * 2;
                            args.extend([
                                "-vf".into(),
                                format!("scale_cuda={target_w}:-2"),
                            ]);
                        } else {
                            args.extend([
                                "-vf".into(),
                                format!("scale={mw}:-2"),
                            ]);
                        }
                    }
                }

                args.extend(Self::encoder_args(&encoder, 18));
                args.extend([
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                ]);
            }
        }

        args.push(output.into());

        if dev_mode {
            args.insert(0, "-v".into());
            args.insert(1, "verbose".into());
        }

        Ok(args)
    }

    /// Build the full ffmpeg argument list for a reduce operation.
    pub async fn build_reduce_args(
        req: &MediaRequest,
    ) -> Result<Vec<String>, String> {
        let input = &req.input;
        let output = &req.output;
        let quality = req.quality.unwrap_or(50) as i32;
        let use_gpu = req.use_gpu.unwrap_or(true);
        let preferred = req.preferred_encoder.as_deref().unwrap_or("");
        let max_width = req.max_width;
        let file_type = req.file_type.as_deref().unwrap_or("video");

        let mut args = vec!["-hide_banner".into(), "-y".into(), "-nostdin".into()];

        let encoder =
            Self::pick_encoder(preferred, "", use_gpu).await;

        if use_gpu && encoder.ends_with("_nvenc") {
            args.extend([
                "-hwaccel".into(),
                "cuda".into(),
                "-hwaccel_output_format".into(),
                "cuda".into(),
            ]);
        } else if use_gpu {
            args.extend(["-hwaccel".into(), "auto".into()]);
        }

        args.extend(["-i".into(), input.into()]);

        match file_type {
            "video" => {
                let crf =
                    (40.0 - (quality as f64 * 0.28)).clamp(1.0, 51.0) as i32;

                if let Some(mw) = max_width {
                    if encoder.ends_with("_nvenc") {
                        args.extend([
                            "-hwaccel_output_format".into(),
                            "cuda".into(),
                        ]);
                        args.extend([
                            "-vf".into(),
                            format!("scale_cuda={mw}:-2"),
                        ]);
                    } else {
                        args.extend([
                            "-vf".into(),
                            format!("scale={mw}:-2"),
                        ]);
                    }
                }

                args.extend(Self::encoder_args(&encoder, crf));
                args.extend([
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "128k".into(),
                ]);
            }
            "photo" => {
                let ext = Path::new(output)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                match ext {
                    "jpg" | "jpeg" => {
                        let qv = (31.0 - (quality as f64 * 0.29))
                            .clamp(2.0, 31.0)
                            as i32;
                        args.extend(["-q:v".into(), qv.to_string()]);
                    }
                    "webp" => {
                        args.extend(["-quality".into(), quality.to_string()])
                    }
                    "png" => {
                        let level = (9.0 - (quality as f64 / 100.0 * 9.0))
                            .clamp(0.0, 9.0)
                            as i32;
                        args.extend([
                            "-compression_level".into(),
                            level.to_string(),
                        ]);
                    }
                    _ => {}
                }
                if let Some(mw) = max_width {
                    args.extend([
                        "-vf".into(),
                        format!("scale={mw}:-1"),
                    ]);
                }
            }
            "audio" => {
                let bitrate = (32.0 + quality as f64 * 3.2)
                    .clamp(32.0, 320.0)
                    as i32;
                args.extend([
                    "-c:a".into(),
                    "libmp3lame".into(),
                    "-b:a".into(),
                    format!("{bitrate}k"),
                ]);
            }
            _ => return Err(format!("Unsupported file type: {file_type}")),
        }

        args.push(output.into());
        Ok(args)
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    async fn pick_encoder(
        preferred: &str,
        _format: &str,
        use_gpu: bool,
    ) -> String {
        if !use_gpu {
            return if preferred.is_empty() || preferred == "libx264" {
                "libx264".into()
            } else {
                preferred.into()
            };
        }
        if !preferred.is_empty() && preferred != "libx264" {
            return preferred.into();
        }
        let output = Command::new(paths::ffmpeg())
            .args(["-hide_banner", "-encoders"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .output()
            .await
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();

        if output.contains("h264_nvenc") {
            "h264_nvenc".into()
        } else if output.contains("h264_amf") {
            "h264_amf".into()
        } else if output.contains("h264_qsv") {
            "h264_qsv".into()
        } else {
            "libx264".into()
        }
    }

    fn encoder_args(encoder: &str, quality: i32) -> Vec<String> {
        if encoder.ends_with("_nvenc") {
            vec![
                "-c:v".into(),
                encoder.into(),
                "-preset".into(),
                "p4".into(),
                "-rc".into(),
                "vbr".into(),
                "-cq".into(),
                quality.to_string(),
                "-b:v".into(),
                "0".into(),
            ]
        } else if encoder.ends_with("_amf") {
            vec![
                "-c:v".into(),
                encoder.into(),
                "-quality".into(),
                "balanced".into(),
                "-rc".into(),
                "cqp".into(),
                "-qp_i".into(),
                quality.to_string(),
                "-qp_p".into(),
                quality.to_string(),
            ]
        } else if encoder.ends_with("_qsv") {
            vec![
                "-c:v".into(),
                encoder.into(),
                "-preset".into(),
                "medium".into(),
                "-global_quality".into(),
                quality.to_string(),
            ]
        } else {
            vec![
                "-c:v".into(),
                encoder.into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                quality.to_string(),
            ]
        }
    }
}

/// Parse HH:MM:SS.ss or HH:MM:SS into total seconds.
fn parse_hhmmss(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().ok()?;
        let m: f64 = parts[1].parse().ok()?;
        let sec: f64 = parts[2].parse().ok()?;
        Some(h * 3600.0 + m * 60.0 + sec)
    } else {
        None
    }
}

// ── Tauri command bindings ─────────────────────────────────────────────────

#[tauri::command]
pub async fn probe_file(input: String) -> Result<ProbeInfo, String> {
    NativeEngine::probe(&input).await
}

#[tauri::command]
pub async fn detect_gpus_native() -> Result<Vec<GpuCapability>, String> {
    NativeEngine::detect_gpus().await
}

#[tauri::command]
pub async fn start_convert_native(
    app: AppHandle,
    input: String,
    output: String,
    format: String,
    dev_mode: bool,
    use_gpu: bool,
    preferred_encoder: String,
) -> Result<(), String> {
    let ops = app.state::<crate::operations::Operations>();
    let operation = ops.begin().map_err(|e| e.to_string())?;

    let req = MediaRequest {
        cmd: "start_convert".into(),
        input,
        output,
        format: Some(format),
        dev_mode: Some(dev_mode),
        use_gpu: Some(use_gpu),
        preferred_encoder: Some(preferred_encoder),
        ..Default::default()
    };

    let args = NativeEngine::build_convert_args(&req).await?;
    NativeEngine::run_ffmpeg(app, args, "convert", Arc::new(operation)).await
}

#[tauri::command]
pub async fn start_reduce_native(
    app: AppHandle,
    input: String,
    output: String,
    quality: u8,
    target_bytes: Option<u64>,
    max_width: Option<u32>,
    file_type: String,
    use_gpu: bool,
    preferred_encoder: String,
) -> Result<(), String> {
    let ops = app.state::<crate::operations::Operations>();
    let operation = ops.begin().map_err(|e| e.to_string())?;

    let req = MediaRequest {
        cmd: "start_reduce".into(),
        input,
        output,
        quality: Some(quality),
        target_bytes,
        max_width,
        file_type: Some(file_type),
        use_gpu: Some(use_gpu),
        preferred_encoder: Some(preferred_encoder),
        ..Default::default()
    };

    let args = NativeEngine::build_reduce_args(&req).await?;
    NativeEngine::run_ffmpeg(app, args, "reduce", Arc::new(operation)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_convert_args_video_to_mp4() {
        let req = MediaRequest {
            cmd: "start_convert".into(),
            input: "test.mp4".into(),
            output: "test.mkv".into(),
            format: Some("mkv".into()),
            use_gpu: Some(false),
            ..Default::default()
        };
        let args = tokio_test::block_on(NativeEngine::build_convert_args(&req)).unwrap();
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"test.mp4".to_string()));
        assert!(args.contains(&"test.mkv".to_string()));
        assert!(args.contains(&"-c:v".to_string()));
        let idx = args.iter().position(|a| a == "-c:v").unwrap();
        assert_eq!(args[idx + 1], "libx264");
    }

    #[test]
    fn build_convert_args_audio_only() {
        let req = MediaRequest {
            cmd: "start_convert".into(),
            input: "test.mp4".into(),
            output: "test.mp3".into(),
            format: Some("mp3".into()),
            use_gpu: Some(false),
            ..Default::default()
        };
        let args = tokio_test::block_on(NativeEngine::build_convert_args(&req)).unwrap();
        assert!(args.contains(&"-vn".to_string()));
        assert!(args.contains(&"-c:a".to_string()));
        let idx = args.iter().position(|a| a == "-c:a").unwrap();
        assert_eq!(args[idx + 1], "libmp3lame");
    }

    #[test]
    fn build_reduce_args_video() {
        let req = MediaRequest {
            cmd: "start_reduce".into(),
            input: "test.mp4".into(),
            output: "reduced.mp4".into(),
            quality: Some(50),
            file_type: Some("video".into()),
            use_gpu: Some(false),
            ..Default::default()
        };
        let args = tokio_test::block_on(NativeEngine::build_reduce_args(&req)).unwrap();
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"test.mp4".to_string()));
        assert!(args.contains(&"reduced.mp4".to_string()));
        assert!(args.contains(&"-c:v".to_string()));
    }

    #[test]
    fn build_reduce_args_photo_jpg() {
        let req = MediaRequest {
            cmd: "start_reduce".into(),
            input: "photo.png".into(),
            output: "photo.jpg".into(),
            quality: Some(80),
            file_type: Some("photo".into()),
            use_gpu: Some(false),
            ..Default::default()
        };
        let args = tokio_test::block_on(NativeEngine::build_reduce_args(&req)).unwrap();
        assert!(args.contains(&"-q:v".to_string()));
    }

    #[test]
    fn build_reduce_args_audio() {
        let req = MediaRequest {
            cmd: "start_reduce".into(),
            input: "song.mp3".into(),
            output: "reduced.mp3".into(),
            quality: Some(75),
            file_type: Some("audio".into()),
            use_gpu: Some(false),
            ..Default::default()
        };
        let args = tokio_test::block_on(NativeEngine::build_reduce_args(&req)).unwrap();
        assert!(args.contains(&"-c:a".to_string()));
        let idx = args.iter().position(|a| a == "-c:a").unwrap();
        assert_eq!(args[idx + 1], "libmp3lame");
    }

    #[test]
    fn encoder_args_nvenc() {
        let args = NativeEngine::encoder_args("h264_nvenc", 18);
        assert!(args.contains(&"-c:v".to_string()));
        assert!(args.contains(&"h264_nvenc".to_string()));
        assert!(args.contains(&"-preset".to_string()));
        assert!(args.contains(&"p4".to_string()));
        assert!(args.contains(&"-rc".to_string()));
        assert!(args.contains(&"vbr".to_string()));
        assert!(args.contains(&"-cq".to_string()));
        assert!(args.contains(&"18".to_string()));
    }

    #[test]
    fn encoder_args_libx264() {
        let args = NativeEngine::encoder_args("libx264", 23);
        assert!(args.contains(&"-c:v".to_string()));
        assert!(args.contains(&"libx264".to_string()));
        assert!(args.contains(&"-crf".to_string()));
        assert!(args.contains(&"23".to_string()));
    }

    #[test]
    fn encoder_args_amf() {
        let args = NativeEngine::encoder_args("h264_amf", 20);
        assert!(args.contains(&"-c:v".to_string()));
        assert!(args.contains(&"h264_amf".to_string()));
        assert!(args.contains(&"-rc".to_string()));
        assert!(args.contains(&"cqp".to_string()));
    }

    #[test]
    fn pick_encoder_cpu_when_gpu_disabled() {
        let enc = tokio_test::block_on(NativeEngine::pick_encoder("", "", false));
        assert_eq!(enc, "libx264");
    }

    #[test]
    fn pick_encoder_respects_preferred() {
        let enc = tokio_test::block_on(NativeEngine::pick_encoder("h264_amf", "mp4", true));
        assert_eq!(enc, "h264_amf");
    }

    #[test]
    fn probe_info_defaults() {
        let info = ProbeInfo {
            width: None,
            height: None,
            duration: None,
            vcodec: None,
            acodec: None,
            format_name: None,
            bitrate: None,
        };
        assert!(info.width.is_none());
        assert!(info.vcodec.is_none());
    }

    #[test]
    fn gpu_capability_serialization() {
        let cap = GpuCapability {
            encoder: "h264_nvenc".into(),
            vendor: "NVIDIA".into(),
            hwaccel: "cuda".into(),
            label: "NVIDIA NVENC H.264".into(),
            works: true,
        };
        let json = serde_json::to_value(&cap).unwrap();
        assert_eq!(json["encoder"], "h264_nvenc");
        assert_eq!(json["vendor"], "NVIDIA");
        assert_eq!(json["works"], true);
    }
}
