//! High-performance native media engine — replaces Python subprocess overhead.
//!
//! Calls ffmpeg directly via tokio async process management with zero-copy
//! streaming, real-time progress parsing, and GPU-accelerated pipelines.
use crate::{operations::Operation, paths};
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
    pub file_type: Option<String>,
    #[serde(default)]
    pub dev_mode: Option<bool>,
    #[serde(default)]
    pub use_gpu: Option<bool>,
    #[serde(default)]
    pub preferred_encoder: Option<String>,
    #[serde(default)]
    pub selected_gpu: Option<String>,
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
            file_type: None,
            dev_mode: None,
            use_gpu: None,
            preferred_encoder: None,
            selected_gpu: None,
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
    pub pix_fmt: Option<String>,
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
        let output = tokio::time::timeout(Duration::from_secs(10), Command::new(paths::ffprobe())
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,codec_name,width,height,pix_fmt:stream_disposition=attached_pic:format=format_name,duration,bit_rate",
                "-of",
                "json",
                input,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .kill_on_drop(true)
            .output()).await.map_err(|_| "ffprobe timed out".to_string())?
            .map_err(|e| format!("ffprobe failed: {e}"))?;
        if !output.status.success() {
            return Err("ffprobe could not read the media file".into());
        }

        let info: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Invalid ffprobe output: {e}"))?;

        let format = info.get("format");
        let streams = info
            .get("streams")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let video = streams.iter().find(|s| {
            s.get("codec_type").and_then(|v| v.as_str()) == Some("video")
                && s.pointer("/disposition/attached_pic")
                    .and_then(|v| v.as_u64())
                    != Some(1)
        });
        let audio = streams
            .iter()
            .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"));

        Ok(ProbeInfo {
            pix_fmt: video
                .and_then(|v| v.get("pix_fmt").and_then(|v| v.as_str()))
                .map(String::from),
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
        // Check persistent cache first (survives app restarts)
        if let Some(works) = crate::persistent_cache::PersistentCache::global().get_encoder(encoder).await {
            log::debug!("Encoder '{}' result from disk cache: {works}", encoder);
            return works;
        }

        use std::{collections::HashMap, sync::OnceLock, time::Instant};
        use tokio::sync::Mutex;
        type Results = HashMap<String, (Instant, bool)>;
        static RESULTS: OnceLock<Mutex<Results>> = OnceLock::new();
        // Serialize the first probe and share its result across simultaneous
        // startup calls and subsequent jobs. No duplicate GPU sessions.
        let mut results = RESULTS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .await;
        if let Some((when, works)) = results.get(encoder) {
            if when.elapsed() < Duration::from_secs(3600) {
                return *works;
            }
        }
        let works = tokio::time::timeout(
            Duration::from_secs(8),
            Command::new(paths::ffmpeg())
                .args([
                    "-v",
                    "error",
                    "-nostdin",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=256x256:r=1:d=0.1",
                    "-frames:v",
                    "1",
                    "-c:v",
                    encoder,
                    "-pix_fmt",
                    "yuv420p",
                    "-f",
                    "null",
                    "-",
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000)
                .kill_on_drop(true)
                .status(),
        )
        .await
        .is_ok_and(|result| result.is_ok_and(|status| status.success()));
        results.insert(encoder.into(), (Instant::now(), works));

        // Persist to disk cache for next app launch
        crate::persistent_cache::PersistentCache::global().set_encoder(encoder, works).await;

        works
    }

    /// Run FFmpeg with machine-readable progress and commit only complete output.
    pub async fn run_ffmpeg(
        app: AppHandle,
        mut args: Vec<String>,
        prefix: &str,
        id: String,
        operation: Arc<Operation>,
    ) -> Result<(), String> {
        let progress_event = format!("{prefix}-progress");
        let finished_event = format!("{prefix}-finished");
        let output = args.last().cloned().ok_or("Missing output path")?;
        let result = async {
            if operation.is_cancelled() {
                return Err("Operation was cancelled".to_string());
            }
            let input = args
                .iter()
                .position(|a| a == "-i")
                .and_then(|i| args.get(i + 1))
                .ok_or("Missing input path")?;
            crate::validation::validate_file_exists(input, "input")?;
            crate::validation::validate_output_path(&output, "output")?;
            if Path::new(&output)
                .canonicalize()
                .ok()
                .is_some_and(|p| Some(p) == Path::new(input).canonicalize().ok())
            {
                return Err("Output must be different from the original file".into());
            }
            let duration = Self::probe(input)
                .await
                .ok()
                .and_then(|p| p.duration)
                .filter(|d| d.is_finite() && *d > 0.0);
            let destination = Path::new(&output);
            let extension = destination
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("mp4");
            let temporary = tempfile::Builder::new()
                .prefix(".convert-")
                .suffix(&format!(".{extension}"))
                .tempfile_in(destination.parent().ok_or("Missing output directory")?)
                .map_err(|e| e.to_string())?
                .into_temp_path();
            *args.last_mut().unwrap() = temporary.to_string_lossy().into_owned();
            let id_for_progress = id.clone();
            Self::execute_ffmpeg(&args, &operation, duration, &|percent| {
                let _ = app.emit(&progress_event, serde_json::json!({ "id": &id_for_progress, "percent": percent }));
            })
            .await?;
            if temporary.metadata().map_err(|e| e.to_string())?.len() == 0 {
                return Err("ffmpeg produced no output".into());
            }
            temporary.persist(destination).map_err(|e| e.to_string())?;
            let _ = app.emit(&progress_event, serde_json::json!({ "id": &id, "percent": 100i32 }));
            Ok(())
        }
        .await;
        let finished = serde_json::json!({
            "id": &id,
            "ok": result.is_ok(),
            "message": result.as_ref().err().cloned().unwrap_or_default(),
            "file_path": if result.is_ok() { output } else { String::new() },
        });
        let _ = app.emit(&finished_event, finished);
        result
    }

    async fn execute_once(
        args: &[String],
        operation: &Operation,
        duration: Option<f64>,
        on_progress: &(impl Fn(i32) + Sync),
    ) -> Result<(), String> {
        if operation.is_cancelled() {
            return Err("Operation was cancelled".into());
        }
        let mut child = Command::new(paths::ffmpeg())
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000)
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;
        let mut lines = BufReader::new(child.stderr.take().ok_or("Missing ffmpeg stderr")?).lines();
        let mut tail = VecDeque::with_capacity(MAX_STDERR_LINES);
        let mut last_progress = -1;
        let mut last_update = std::time::Instant::now();
        let process_result = loop {
            if operation.is_cancelled() {
                break Err("Operation was cancelled".to_string());
            }
            match tokio::time::timeout(Duration::from_millis(100), lines.next_line()).await {
                Err(_) => continue,
                Ok(Err(e)) => break Err(format!("ffmpeg stderr read error: {e}")),
                Ok(Ok(None)) => break Ok(()),
                Ok(Ok(Some(line))) => {
                    if let (Some(seconds), Some(total)) = (
                        line.strip_prefix("out_time=").and_then(parse_hhmmss),
                        duration,
                    ) {
                        let percent = ((seconds / total * 100.0) as i32).clamp(0, 99);
                        if percent > last_progress
                            && last_update.elapsed() >= Duration::from_millis(PROGRESS_THROTTLE_MS)
                        {
                            on_progress(percent);
                            last_progress = percent;
                            last_update = std::time::Instant::now();
                        }
                    }
                    if tail.len() == MAX_STDERR_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line[..line.floor_char_boundary(MAX_LINE_LENGTH)].to_owned());
                }
            }
        };
        if process_result.is_err() {
            let _ = child.kill().await;
        }
        let status = match tokio::time::timeout(Duration::from_secs(10), child.wait()).await {
            Ok(result) => result.map_err(|e| e.to_string())?,
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err("ffmpeg timed out after stderr closed".into());
            }
        };
        process_result?;
        if operation.is_cancelled() {
            return Err("Operation was cancelled".into());
        }
        if !status.success() {
            return Err(format!(
                "ffmpeg failed (exit {}): {}",
                status.code().unwrap_or(-1),
                tail.into_iter().collect::<Vec<_>>().join("\n")
            ));
        }
        Ok(())
    }

    async fn execute_ffmpeg(
        args: &[String],
        operation: &Operation,
        duration: Option<f64>,
        on_progress: &(impl Fn(i32) + Sync),
    ) -> Result<(), String> {
        let mut args = args.to_vec();
        args.splice(
            0..0,
            ["-nostats".into(), "-progress".into(), "pipe:2".into()],
        );
        Self::execute_once(&args, operation, duration, on_progress).await
    }

    /// Build native commands with container-specific codecs and one encoder selection.
    pub async fn build_convert_args(req: &MediaRequest) -> Result<Vec<String>, String> {
        let format = req.format.as_deref().unwrap_or("");
        let mut args = vec!["-hide_banner".into(), "-y".into(), "-nostdin".into()];
        let audio = match format {
            "mp3" => Some(("libmp3lame", Some("192k"))),
            "aac" | "m4a" => Some(("aac", Some("192k"))),
            "wav" => Some(("pcm_s16le", None)),
            "flac" => Some(("flac", None)),
            "ogg" => Some(("libvorbis", Some("192k"))),
            "opus" => Some(("libopus", Some("128k"))),
            "wma" => Some(("wmav2", Some("192k"))),
            _ => None,
        };
        if let Some((codec, bitrate)) = audio {
            args.extend([
                "-i".into(),
                req.input.clone(),
                "-map_metadata".into(),
                "0".into(),
                "-map".into(),
                "0:a:0".into(),
                "-vn".into(),
                "-c:a".into(),
                codec.into(),
            ]);
            if let Some(rate) = bitrate {
                args.extend(["-b:a".into(), rate.into()]);
            }
        } else if matches!(
            format,
            "jpg" | "jpeg" | "png" | "webp" | "bmp" | "tiff" | "tif" | "avif" | "ico"
        ) {
            args.extend([
                "-i".into(),
                req.input.clone(),
                "-frames:v".into(),
                "1".into(),
            ]);
            match format {
                "jpg" | "jpeg" => args.extend(["-q:v".into(), "2".into()]),
                "webp" => args.extend(["-quality".into(), "80".into()]),
                "png" => args.extend(["-compression_level".into(), "3".into()]),
                _ => {}
            }
        } else {
            let audio_codec = match format {
                "mp4" | "mkv" | "mov" | "flv" | "m4v" | "3gp" | "mts" => "aac",
                "avi" => "libmp3lame",
                "webm" => "libopus",
                "wmv" => "wmav2",
                "mpg" | "mpeg" | "vob" => "mp2",
                "gif" => "",
                _ => return Err(format!("Unsupported output format: {format}")),
            };
            let encoder = Self::pick_encoder(
                req.preferred_encoder.as_deref().unwrap_or(""),
                format,
                req.use_gpu.unwrap_or(false),
                req.selected_gpu.as_deref().unwrap_or(""),
            )
            .await?;
            let probe = Self::probe(&req.input).await.ok();
            let can_copy = probe.as_ref().is_some_and(|p| {
                    p.vcodec
                        .as_deref()
                        .is_some_and(|c| Some(c) == Self::codec_for_encoder(&encoder))
                });
            let cuda = !can_copy && Self::cuda_frames(&encoder, probe.as_ref());
            args.extend(Self::decode_args(cuda));
            args.extend([
                "-i".into(),
                req.input.clone(),
                "-map_metadata".into(),
                "0".into(),
                "-map".into(),
                "0:V:0".into(),
                "-map".into(),
                "0:a:0?".into(),
            ]);
            if can_copy {
                args.extend(["-c:v".into(), "copy".into()]);
            } else {
                args.extend(Self::encoder_args(&encoder, 18));
            }
            if audio_codec.is_empty() {
                args.push("-an".into());
            } else {
                let codec_name = match audio_codec {
                    "libopus" => "opus",
                    "libmp3lame" => "mp3",
                    c => c,
                };
                if can_copy && probe.as_ref().and_then(|p| p.acodec.as_deref()) == Some(codec_name)
                {
                    args.extend(["-c:a".into(), "copy".into()]);
                } else {
                    args.extend([
                        "-c:a".into(),
                        audio_codec.into(),
                        "-b:a".into(),
                        "192k".into(),
                    ]);
                }
            }
        }
        if matches!(format, "mp4" | "mov" | "m4v") {
            args.extend(["-movflags".into(), "+use_metadata_tags".into()]);
        }
        args.push(req.output.clone());
        Ok(args)
    }

    pub async fn build_transcoder_args(req: &MediaRequest) -> Result<Vec<String>, String> {
        if req.target_bytes.is_some() {
            return Err("Target-size reduction requires the budgeted Python engine".into());
        }
        let quality = req.quality.unwrap_or(50) as i32;
        if !(1..=100).contains(&quality) {
            return Err("Quality must be between 1 and 100".into());
        }
        let file_type = req.file_type.as_deref().unwrap_or("video");
        let format = Path::new(&req.output)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let mut args = vec!["-hide_banner".into(), "-y".into(), "-nostdin".into()];
        let encoder = if file_type == "video" {
            Self::pick_encoder(
                req.preferred_encoder.as_deref().unwrap_or(""),
                format,
                req.use_gpu.unwrap_or(false),
                req.selected_gpu.as_deref().unwrap_or(""),
            )
            .await?
        } else {
            String::new()
        };
        let probe = if file_type == "video" {
            Self::probe(&req.input).await.ok()
        } else {
            None
        };
        let cuda = Self::cuda_frames(&encoder, probe.as_ref());
        args.extend(Self::decode_args(cuda));
        args.extend([
            "-i".into(),
            req.input.clone(),
            "-map_metadata".into(),
            "0".into(),
        ]);
        match file_type {
            "video" => {
                args.extend(Self::encoder_args(
                    &encoder,
                    (40.0 - quality as f64 * 0.28).clamp(1.0, 51.0) as i32,
                ));
                args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "128k".into()]);
            }
            "photo" => {
                match format {
                    "jpg" | "jpeg" => args.extend([
                        "-q:v".into(),
                        ((31.0 - quality as f64 * 0.29).clamp(2.0, 31.0) as i32).to_string(),
                    ]),
                    "webp" => args.extend(["-quality".into(), quality.to_string()]),
                    "png" => args.extend([
                        "-compression_level".into(),
                        ((9.0 - quality as f64 * 0.09).clamp(0.0, 9.0) as i32).to_string(),
                    ]),
                    _ => {}
                }
                args.extend(["-frames:v".into(), "1".into()]);
            }
            "audio" => args.extend([
                "-vn".into(),
                "-c:a".into(),
                "libmp3lame".into(),
                "-b:a".into(),
                format!(
                    "{}k",
                    (32.0 + quality as f64 * 3.2).clamp(32.0, 320.0) as i32
                ),
            ]),
            _ => return Err(format!("Unsupported file type: {file_type}")),
        }
        if matches!(format, "mp4" | "mov" | "m4v") {
            args.extend(["-movflags".into(), "+use_metadata_tags".into()]);
        }
        args.push(req.output.clone());
        Ok(args)
    }

    fn codec_for_encoder(encoder: &str) -> Option<&str> {
        match encoder {
            "libx264" | "h264_nvenc" | "h264_amf" | "h264_qsv" => Some("h264"),
            "hevc_nvenc" | "hevc_amf" | "hevc_qsv" => Some("hevc"),
            "av1_nvenc" | "av1_amf" | "av1_qsv" => Some("av1"),
            "libvpx-vp9" => Some("vp9"),
            _ => None,
        }
    }

    fn cuda_frames(encoder: &str, probe: Option<&ProbeInfo>) -> bool {
        encoder.ends_with("_nvenc")
            && probe.is_some_and(|p| {
                matches!(
                    p.vcodec.as_deref(),
                    Some("h264" | "hevc" | "av1" | "vp9" | "vp8" | "mpeg2video" | "vc1")
                ) && matches!(
                    p.pix_fmt.as_deref(),
                    Some("yuv420p" | "yuvj420p" | "yuv420p10le" | "nv12" | "p010le")
                )
            })
    }

    fn decode_args(cuda: bool) -> Vec<String> {
        if cuda {
            vec![
                "-hwaccel".into(),
                "cuda".into(),
                "-hwaccel_output_format".into(),
                "cuda".into(),
            ]
        } else {
            vec![]
        }
    }

    fn scale_filter(width: u32, cuda: bool, video: bool) -> Result<String, String> {
        if width == 0 {
            return Err("Width must be positive".into());
        }
        let width = if video { (width / 2 * 2).max(2) } else { width };
        let (name, interpolation) = if cuda {
            ("scale_cuda", "interp_algo=lanczos")
        } else {
            ("scale", "flags=lanczos")
        };
        let height = if video { -2 } else { -1 };
        Ok(format!(
            "{name}=w='min(iw,{width})':h={height}:{interpolation}"
        ))
    }

    async fn pick_encoder(preferred: &str, format: &str, use_gpu: bool, selected_gpu: &str) -> Result<String, String> {
        let fallback = match format {
            "webm" => "libvpx-vp9",
            "wmv" => "wmv2",
            "mpg" | "mpeg" | "vob" => "mpeg2video",
            "gif" => "gif",
            _ => "libx264",
        };
        if use_gpu {
            if fallback == "gif" {
                return Ok(fallback.into());
            }
            // If user manually selected a GPU encoder, try that first
            if !selected_gpu.is_empty() {
                let compatible = Self::codec_for_encoder(selected_gpu).is_some()
                    && ((selected_gpu.starts_with("h264_") && fallback == "libx264")
                        || (selected_gpu.starts_with("hevc_")
                            && matches!(format, "mp4" | "mkv" | "mov" | "m4v"))
                        || (selected_gpu.starts_with("av1_") && matches!(format, "mp4" | "mkv" | "webm")));
                if compatible && Self::test_encoder(selected_gpu).await {
                    return Ok(selected_gpu.into());
                }
                return Err(format!("The selected GPU encoder ({selected_gpu}) is unavailable or incompatible with this format. Choose another encoder or format in Settings."));
            }
            if fallback != "libx264" {
                return Err("This output codec requires CPU encoding. Choose MP4/MKV for GPU encoding, or select CPU in Settings.".into());
            }
            for encoder in ["h264_nvenc", "h264_amf", "h264_qsv"] {
                if Self::test_encoder(encoder).await {
                    return Ok(encoder.into());
                }
            }
            return Err("No working GPU video encoder is available. Select CPU in Settings to use software encoding.".into());
        } else {
            if preferred.is_empty() || preferred == "libx264" {
                return Ok(fallback.into());
            }
            let compatible = Self::codec_for_encoder(preferred).is_some()
                && ((preferred.starts_with("h264_") && fallback == "libx264")
                    || (preferred.starts_with("hevc_")
                        && matches!(format, "mp4" | "mkv" | "mov" | "m4v"))
                    || (preferred.starts_with("av1_") && matches!(format, "mp4" | "mkv" | "webm")));
            if compatible && Self::test_encoder(preferred).await {
                return Ok(preferred.into());
            }
            return Err("The selected GPU encoder is unavailable or incompatible. Choose another encoder or format in Settings.".into());
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
        } else if matches!(encoder, "libx264" | "libx265") {
            vec![
                "-c:v".into(),
                encoder.into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                quality.to_string(),
            ]
        } else {
            vec!["-c:v".into(), encoder.into()]
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
    // Check persistent cache
    let (size, mtime) = std::fs::metadata(&input)
        .ok()
        .map(|m| (Some(m.len()), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs()))))
        .unwrap_or((None, None));
    let cache_key = format!("probe:{input}");
    let pc = crate::persistent_cache::PersistentCache::global();
    if let Some(cached) = pc.get_file(&cache_key, size, mtime).await {
        return serde_json::from_value(cached).map_err(|e| e.to_string());
    }

    let result = NativeEngine::probe(&input).await?;

    // Cache the result
    if let Ok(val) = serde_json::to_value(&result) {
        pc.set_file(&cache_key, val, size, mtime).await;
    }
    Ok(result)
}

#[tauri::command]
pub async fn detect_gpus_native() -> Result<Vec<GpuCapability>, String> {
    NativeEngine::detect_gpus().await
}

#[tauri::command]
pub async fn start_convert_native(
    app: AppHandle,
    id: String,
    input: String,
    output: String,
    format: String,
    dev_mode: bool,
    use_gpu: bool,
    preferred_encoder: String,
    selected_gpu: Option<String>,
) -> Result<(), String> {
    let ops = app.state::<crate::operations::Operations>();
    let operation = ops.begin(crate::operations::OpType::Convert, id.clone()).await.map_err(|e| e.to_string())?;

    let req = MediaRequest {
        cmd: "start_convert".into(),
        input,
        output,
        format: Some(format),
        dev_mode: Some(dev_mode),
        use_gpu: Some(use_gpu),
        preferred_encoder: Some(preferred_encoder),
        selected_gpu,
        ..Default::default()
    };

    let args = NativeEngine::build_convert_args(&req).await?;
    NativeEngine::run_ffmpeg(app, args, "convert", id, Arc::new(operation)).await
}

#[tauri::command]
pub async fn start_transcoder_native(
    app: AppHandle,
    id: String,
    input: String,
    output: String,
    quality: u8,
    target_bytes: Option<u64>,
    file_type: String,
    use_gpu: bool,
    preferred_encoder: String,
    selected_gpu: Option<String>,
) -> Result<(), String> {
    if target_bytes.is_some() {
        return crate::commands::media::start_transcoder(
            app,
            id,
            input,
            output,
            quality,
            target_bytes,
            file_type,
            use_gpu,
            preferred_encoder,
            selected_gpu,
        )
        .await;
    }
    let ops = app.state::<crate::operations::Operations>();
    let operation = ops.begin(crate::operations::OpType::Transcoder, id.clone()).await.map_err(|e| e.to_string())?;

    let req = MediaRequest {
        cmd: "start_transcoder".into(),
        input,
        output,
        quality: Some(quality),
        target_bytes,
        file_type: Some(file_type),
        use_gpu: Some(use_gpu),
        preferred_encoder: Some(preferred_encoder),
        selected_gpu,
        ..Default::default()
    };

    let args = NativeEngine::build_transcoder_args(&req).await?;
    NativeEngine::run_ffmpeg(app, args, "transcoder", id, Arc::new(operation)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn execute(args: &[String]) {
        let state = crate::operations::Operations::default();
        let operation = state.begin(crate::operations::OpType::Convert, "test".into()).await.unwrap();
        tokio::time::timeout(
            Duration::from_secs(60),
            NativeEngine::execute_ffmpeg(args, &operation, Some(0.3), &|_| {}),
        )
        .await
        .expect("ffmpeg timeout")
        .unwrap();
    }

    #[tokio::test]
    async fn real_media_conversion_formats_on_cpu() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder
            .path()
            .join("source.mp4")
            .to_string_lossy()
            .into_owned();
        let args: Vec<String> = [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=10:duration=0.3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.3",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            &source,
        ]
        .into_iter()
        .map(String::from)
        .collect();
        execute(&args).await;
        for format in [
            "mp4", "mkv", "avi", "mov", "webm", "wmv", "flv", "gif", "m4v", "mpg", "mpeg", "3gp",
            "mts", "vob", "mp3", "aac", "m4a", "wav", "flac", "ogg", "opus", "wma", "jpg", "png",
            "webp", "bmp", "tiff", "avif",
        ] {
            let output = folder
                .path()
                .join(format!("out.{format}"))
                .to_string_lossy()
                .into_owned();
            let req = MediaRequest {
                input: source.clone(),
                output: output.clone(),
                format: Some(format.into()),
                // Format coverage must run on hosts without hardware encoders.
                // Hardware conversion and reduction have separate capability-gated tests.
                use_gpu: Some(false),
                ..Default::default()
            };
            execute(&NativeEngine::build_convert_args(&req).await.unwrap()).await;
            let info = NativeEngine::probe(&output).await.unwrap();
            assert!(
                info.vcodec.is_some() || info.acodec.is_some(),
                "No output stream for {format}"
            );
        }
    }

    #[tokio::test]
    async fn native_budget_cannot_be_silently_ignored() {
        let req = MediaRequest {
            target_bytes: Some(1000),
            ..Default::default()
        };
        assert!(NativeEngine::build_transcoder_args(&req)
            .await
            .unwrap_err()
            .contains("Target-size"));
    }

    #[tokio::test]
    async fn manual_gpu_real_conversion_and_reduction() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("source.mp4").to_string_lossy().into_owned();
        let args: Vec<String> = ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=256x256:d=0.4", "-c:v", "mpeg4", &source].into_iter().map(String::from).collect();
        execute(&args).await;
        for encoder in ["h264_amf", "h264_nvenc"] {
            if !NativeEngine::test_encoder(encoder).await { continue; }
            for reduce in [false, true] {
                let output = folder.path().join(format!("{encoder}-{reduce}.mp4")).to_string_lossy().into_owned();
                let request = MediaRequest {
                    input: source.clone(), output: output.clone(), format: Some("mp4".into()),
                    file_type: Some("video".into()), use_gpu: Some(true), selected_gpu: Some(encoder.into()),
                    ..Default::default()
                };
                let args = if reduce { NativeEngine::build_transcoder_args(&request).await.unwrap() }
                    else { NativeEngine::build_convert_args(&request).await.unwrap() };
                assert!(args.windows(2).any(|pair| pair[0] == "-c:v" && pair[1] == encoder));
                execute(&args).await;
                assert_eq!(NativeEngine::probe(&output).await.unwrap().vcodec.as_deref(), Some("h264"));
            }
        }
    }

    #[tokio::test]
    async fn parallel_gpu_real_reduction() {
        if !NativeEngine::test_encoder("h264_nvenc").await || !NativeEngine::test_encoder("h264_amf").await {
            eprintln!("Parallel GPU test skipped: requires working NVIDIA and AMD encoders");
            return;
        }
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("source.mp4").to_string_lossy().into_owned();
        let args: Vec<String> = ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=2", "-c:v", "libx264", &source].into_iter().map(String::from).collect();
        execute(&args).await;
        let run = |encoder: &'static str| {
            let source = source.clone();
            let output = folder.path().join(format!("{encoder}.mp4")).to_string_lossy().into_owned();
            async move {
                let request = MediaRequest { input: source, output: output.clone(), file_type: Some("video".into()),
                    use_gpu: Some(true), selected_gpu: Some(encoder.into()), ..Default::default() };
                let args = NativeEngine::build_transcoder_args(&request).await.unwrap();
                assert!(args.windows(2).any(|pair| pair[0] == "-c:v" && pair[1] == encoder));
                execute(&args).await;
                assert_eq!(NativeEngine::probe(&output).await.unwrap().vcodec.as_deref(), Some("h264"));
            }
        };
        tokio::join!(run("h264_nvenc"), run("h264_amf"));
    }

    #[test]
    fn manual_gpu_does_not_fall_back_to_auto() {
        let result = tokio_test::block_on(NativeEngine::pick_encoder("", "mp4", true, "unknown_gpu"));
        assert!(result.unwrap_err().contains("selected GPU encoder"));
    }

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
    fn build_transcoder_args_video() {
        let req = MediaRequest {
            cmd: "start_transcoder".into(),
            input: "test.mp4".into(),
            output: "reduced.mp4".into(),
            quality: Some(50),
            file_type: Some("video".into()),
            use_gpu: Some(false),
            ..Default::default()
        };
        let args = tokio_test::block_on(NativeEngine::build_transcoder_args(&req)).unwrap();
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"test.mp4".to_string()));
        assert!(args.contains(&"reduced.mp4".to_string()));
        assert!(args.contains(&"-c:v".to_string()));
    }

    #[test]
    fn build_transcoder_args_photo_jpg() {
        let req = MediaRequest {
            cmd: "start_transcoder".into(),
            input: "photo.png".into(),
            output: "photo.jpg".into(),
            quality: Some(80),
            file_type: Some("photo".into()),
            use_gpu: Some(false),
            ..Default::default()
        };
        let args = tokio_test::block_on(NativeEngine::build_transcoder_args(&req)).unwrap();
        assert!(args.contains(&"-q:v".to_string()));
    }

    #[test]
    fn build_transcoder_args_audio() {
        let req = MediaRequest {
            cmd: "start_transcoder".into(),
            input: "song.mp3".into(),
            output: "reduced.mp3".into(),
            quality: Some(75),
            file_type: Some("audio".into()),
            use_gpu: Some(false),
            ..Default::default()
        };
        let args = tokio_test::block_on(NativeEngine::build_transcoder_args(&req)).unwrap();
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
        let enc = tokio_test::block_on(NativeEngine::pick_encoder("", "", false, "")).unwrap();
        assert_eq!(enc, "libx264");
    }

    #[test]
    fn pick_encoder_respects_preferred() {
        let enc =
            tokio_test::block_on(NativeEngine::pick_encoder("libx264", "mp4", false, "")).unwrap();
        assert_eq!(enc, "libx264");
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
            pix_fmt: None,
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
