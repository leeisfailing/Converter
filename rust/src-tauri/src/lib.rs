#![recursion_limit = "256"]
mod blur;
mod settings;
mod validation;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

use blur::settings::BlurSettings;
use blur::weighting;
use blur::presets;
use blur::video_info;
use blur::renderer;
use blur::gpu;
use blur::config;
use settings::AppSettings;

use std::sync::atomic::{AtomicU64, Ordering};
static COMPRESS_COUNTER: AtomicU64 = AtomicU64::new(1);

fn find_ffmpeg() -> String {
    // Check bundled binary relative to the exe (Tauri externalBin places in same dir on Windows)
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) {
        // Tauri externalBin: same directory as exe
        for name in &["ffmpeg.exe", "ffmpeg"] {
            let p = exe_dir.join(name);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
        // Dev / Engine/bin layout
        for name in &["ffmpeg.exe", "ffmpeg"] {
            let p = exe_dir.join("Engine").join("bin").join(name);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }
    // Fallback: check relative to CWD
    if let Ok(cwd) = std::env::current_dir() {
        for name in &["ffmpeg.exe", "ffmpeg"] {
            let p = cwd.join("Engine").join("bin").join(name);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }
    "ffmpeg".to_string()
}

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

pub struct PythonEngine {
    pub child: tokio::sync::Mutex<Option<Child>>,
}

impl Default for PythonEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl PythonEngine {
    pub fn new() -> Self {
        Self {
            child: tokio::sync::Mutex::new(None),
        }
    }
}

fn get_engine_path() -> String {
    // First try runtime path relative to the executable
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) {
        let engine_path = exe_dir.parent().unwrap_or(&exe_dir).join("Engine").join("__main__.py");
        if engine_path.exists() {
            return engine_path.to_string_lossy().to_string();
        }
    }
    // Fallback to compile-time path (development)
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let engine_path = std::path::Path::new(manifest_dir)
        .parent()
        .unwrap_or_else(|| std::path::Path::new(manifest_dir))
        .parent()
        .unwrap_or_else(|| std::path::Path::new(manifest_dir))
        .join("Engine")
        .join("__main__.py");
    engine_path.to_string_lossy().to_string()
}

fn find_python() -> String {
    for name in &["py", "python3", "python"] {
        if let Ok(mut child) = std::process::Command::new(name)
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            let _ = child.wait();
            return name.to_string();
        }
    }
    "python".to_string()
}

async fn run_interactive_command(
    app: AppHandle,
    cmd_json: serde_json::Value,
    event_prefix: &str,
) -> Result<(), String> {
    let engine_path = get_engine_path();
    let python = find_python();

    let mut child = Command::new(&python)
        .arg(&engine_path)
        .arg("--interactive")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", python, e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let mut stdin = stdin;
    let cmd_str = serde_json::to_string(&cmd_json).map_err(|e| e.to_string())?;
    if let Err(e) = stdin.write_all(cmd_str.as_bytes()).await {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(e.to_string());
    }
    if let Err(e) = stdin.write_all(b"\n").await {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(e.to_string());
    }
    drop(stdin);

    {
        let state = app.state::<PythonEngine>();
        let mut guard = state.child.lock().await;
        if guard.is_some() {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("An operation is already in progress".to_string());
        }
        *guard = Some(child);
    }

    let app_handle = app.clone();
    let prefix = event_prefix.to_string();

    tokio::task::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[engine stderr] {}", line);
        }
    });

    let app_handle2 = app_handle.clone();
    let prefix2 = prefix.clone();
    tauri::async_runtime::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                        let event_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        match event_type {
                            "progress" => {
                                if let Some(percent) = parsed.get("percent").and_then(|v| v.as_i64()) {
                                    let _ = app_handle.emit(&format!("{}-progress", prefix), percent as i32);
                                }
                            }
                            "download_status" => {
                                if let Some(status) = parsed.get("status") {
                                    let _ = app_handle.emit(&format!("{}-status", prefix), status.clone());
                                }
                            }
                            "finished" => {
                                let ok = parsed.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                                let message = parsed.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let file_path = parsed.get("file_path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let _ = app_handle.emit(
                                    &format!("{}-finished", prefix),
                                    FinishedEvent { ok, message, file_path },
                                );
                                break;
                            }
                            _ => {}
                        }
                    }
                }
                Ok(None) => {
                    break;
                }
                Err(e) => {
                    let _ = app_handle2.emit(
                        &format!("{}-finished", prefix2),
                        FinishedEvent {
                            ok: false,
                            message: format!("Engine output read error: {}", e),
                            file_path: String::new(),
                        },
                    );
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn detect_file(_app: AppHandle, path: String, dev_mode: bool) -> Result<DetectFileResponse, String> {
    validation::validate_file_exists(&path, "path")?;

    let engine_path = get_engine_path();
    let python = find_python();

    let cmd_json = serde_json::json!({
        "cmd": "detect_file",
        "path": path,
        "dev_mode": dev_mode,
    });

    let mut child = Command::new(&python)
        .arg(&engine_path)
        .arg("--interactive")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", python, e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let mut stdin = stdin;
    let cmd_str = serde_json::to_string(&cmd_json).map_err(|e| e.to_string())?;
    stdin.write_all(cmd_str.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    drop(stdin);

    // Read stderr in a background task to prevent pipe deadlock
    let stderr_handle = tokio::task::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut output = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            output.push_str(&line);
            output.push('\n');
        }
        output
    });

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(ok_val) = val.get("ok") {
                        if ok_val.as_bool() == Some(false) {
                            let error_msg = val.get("error")
                                .and_then(|e| e.as_str())
                                .unwrap_or("Unknown engine error");
                            let stderr_output = stderr_handle.await.unwrap_or_default();
                            let full_error = if !stderr_output.trim().is_empty() {
                                format!("{}\nstderr: {}", error_msg, stderr_output.trim())
                            } else {
                                error_msg.to_string()
                            };
                            return Err(full_error);
                        }
                    }
                    if let Ok(parsed) = serde_json::from_value::<DetectFileResponse>(val) {
                        return Ok(parsed);
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                let stderr_output = stderr_handle.await.unwrap_or_default();
                if !stderr_output.trim().is_empty() {
                    return Err(format!("Engine read error: {}\nstderr: {}", e, stderr_output.trim()));
                }
                return Err(format!("Engine output read error: {}", e));
            }
        }
    }

    let stderr_output = stderr_handle.await.unwrap_or_default();
    if !stderr_output.trim().is_empty() {
        return Err(format!("Engine error: {}", stderr_output.trim()));
    }

    Err("No response from engine".to_string())
}

#[tauri::command]
async fn detect_url(_app: AppHandle, url: String) -> Result<DetectUrlResponse, String> {
    validation::validate_url(&url)?;

    let engine_path = get_engine_path();
    let python = find_python();

    let cmd_json = serde_json::json!({
        "cmd": "detect_url",
        "url": url,
    });

    let mut child = Command::new(&python)
        .arg(&engine_path)
        .arg("--interactive")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", python, e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let mut stdin = stdin;
    let cmd_str = serde_json::to_string(&cmd_json).map_err(|e| e.to_string())?;
    stdin.write_all(cmd_str.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    drop(stdin);

    // Read stderr in a background task to prevent pipe deadlock
    let stderr_handle = tokio::task::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut output = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            output.push_str(&line);
            output.push('\n');
        }
        output
    });

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(ok_val) = val.get("ok") {
                        if ok_val.as_bool() == Some(false) {
                            let error_msg = val.get("error")
                                .and_then(|e| e.as_str())
                                .unwrap_or("Unknown engine error");
                            let stderr_output = stderr_handle.await.unwrap_or_default();
                            let full_error = if !stderr_output.trim().is_empty() {
                                format!("{}\nstderr: {}", error_msg, stderr_output.trim())
                            } else {
                                error_msg.to_string()
                            };
                            return Err(full_error);
                        }
                    }
                    if let Ok(parsed) = serde_json::from_value::<DetectUrlResponse>(val) {
                        return Ok(parsed);
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                let stderr_output = stderr_handle.await.unwrap_or_default();
                if !stderr_output.trim().is_empty() {
                    return Err(format!("Engine read error: {}\nstderr: {}", e, stderr_output.trim()));
                }
                return Err(format!("Engine output read error: {}", e));
            }
        }
    }

    let stderr_output = stderr_handle.await.unwrap_or_default();
    if !stderr_output.trim().is_empty() {
        return Err(format!("Engine error: {}", stderr_output.trim()));
    }

    Err("No response from engine".to_string())
}

#[tauri::command]
async fn start_convert(
    app: AppHandle,
    input: String,
    output: String,
    format: String,
    dev_mode: bool,
) -> Result<(), String> {
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;
    validation::validate_string(&format, "format", 64)?;

    let cmd_json = serde_json::json!({
        "cmd": "start_convert",
        "input": input,
        "output": output,
        "format": format,
        "dev_mode": dev_mode,
    });

    run_interactive_command(app, cmd_json, "convert").await
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    url: String,
    format_type: String,
    output_dir: String,
) -> Result<(), String> {
    validation::validate_url(&url)?;
    validation::validate_string(&format_type, "format_type", 64)?;
    validation::validate_output_dir(&output_dir)?;

    let cmd_json = serde_json::json!({
        "cmd": "start_download",
        "url": url,
        "format_type": format_type,
        "output_dir": output_dir,
    });

    run_interactive_command(app, cmd_json, "download").await
}

#[tauri::command]
async fn cancel_operation(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PythonEngine>();
    let mut child_guard = state.child.lock().await;
    if let Some(ref mut child) = *child_guard {
        let _ = child.kill().await;
    }
    *child_guard = None;
    Ok(())
}

// ===== BLUR COMMANDS =====

#[tauri::command]
async fn detect_video_info(path: String) -> Result<VideoInfoResponse, String> {
    validation::validate_file_exists(&path, "path")?;
    let info = video_info::get_video_info(&path)?;

    Ok(VideoInfoResponse {
        ok: true,
        has_video_stream: info.has_video_stream,
        fps_num: info.fps_num,
        fps_den: info.fps_den,
        duration: info.duration,
        color_range: info.color_range,
        pix_fmt: info.pix_fmt,
        color_space: info.color_space,
        color_transfer: info.color_transfer,
        color_primaries: info.color_primaries,
        sample_rate: info.sample_rate,
    })
}

#[tauri::command]
async fn start_blur(
    app: AppHandle,
    input: String,
    output: String,
    settings_json: serde_json::Value,
) -> Result<(), String> {
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;

    let settings: BlurSettings = serde_json::from_value(settings_json)
        .map_err(|e| format!("Invalid settings: {}", e))?;

    let video_info = video_info::get_video_info(&input)?;

    if !video_info.has_video_stream {
        return Err("No video stream found in input file".to_string());
    }

    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        let result = renderer::run_render(
            &input,
            &output,
            &video_info,
            &settings,
            |current, total| {
                let percent = if total > 0 {
                    ((current as f64 / total as f64) * 100.0) as i32
                } else {
                    0
                };
                let _ = app_handle.emit("blur-progress", percent);
            },
        );

        match result {
            Ok(()) => {
                let _ = app_handle.emit(
                    "blur-finished",
                    FinishedEvent {
                        ok: true,
                        message: String::new(),
                        file_path: output,
                    },
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "blur-finished",
                    FinishedEvent {
                        ok: false,
                        message: e,
                        file_path: String::new(),
                    },
                );
            }
        }
    })
    .await
    .map_err(|e| format!("Render task failed: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_weight_preview(
    blur_weighting: String,
    blur_amount: f64,
    video_fps: f64,
    output_fps: f64,
    gaussian_std_dev: f64,
    gaussian_mean: f64,
    gaussian_bound: String,
) -> Result<WeightPreviewResponse, String> {
    validation::validate_string(&blur_weighting, "blur_weighting", 64)?;
    validation::validate_string(&gaussian_bound, "gaussian_bound", 16)?;

    match weighting::get_weight_preview(
        &blur_weighting,
        blur_amount,
        video_fps,
        output_fps,
        gaussian_std_dev,
        gaussian_mean,
        &gaussian_bound,
    ) {
        Ok(preview) => Ok(WeightPreviewResponse {
            ok: true,
            weights: preview.weights,
            labels: preview.labels,
            error: None,
        }),
        Err(e) => Ok(WeightPreviewResponse {
            ok: false,
            weights: vec![],
            labels: vec![],
            error: Some(e),
        }),
    }
}

#[tauri::command]
async fn get_encode_presets(gpu_type: String) -> Result<PresetListResponse, String> {
    validation::validate_string(&gpu_type, "gpu_type", 32)?;
    let preset_list = presets::get_available_presets(&gpu_type);

    Ok(PresetListResponse {
        ok: true,
        presets: preset_list
            .iter()
            .map(|p| PresetInfo {
                name: p.name.clone(),
                codec: p.codec.clone(),
            })
            .collect(),
    })
}

#[tauri::command]
async fn get_quality_config(codec: String) -> Result<QualityConfigResponse, String> {
    validation::validate_string(&codec, "codec", 32)?;
    let config = presets::get_quality_config(&codec);

    Ok(QualityConfigResponse {
        ok: true,
        min_quality: config.min_quality,
        max_quality: config.max_quality,
        quality_label: config.quality_label,
    })
}

#[tauri::command]
async fn detect_gpu() -> Result<GpuInfoResponse, String> {
    let info = gpu::detect_gpu_type();

    Ok(GpuInfoResponse {
        ok: true,
        gpu_type: info.gpu_type,
        has_hardware_encoder: info.has_hardware_encoder,
    })
}

// ===== CONFIG COMMANDS =====

#[tauri::command]
async fn save_blur_config(
    name: String,
    description: String,
    settings_json: serde_json::Value,
) -> Result<(), String> {
    validation::validate_string(&name, "name", 200)?;
    validation::validate_string(&description, "description", 500)?;

    let settings: BlurSettings = serde_json::from_value(settings_json)
        .map_err(|e| format!("Invalid settings: {}", e))?;

    config::save_config(&name, &description, &settings)
}

#[tauri::command]
async fn load_blur_config(name: String) -> Result<ConfigLoadResponse, String> {
    validation::validate_string(&name, "name", 200)?;

    match config::load_config(&name) {
        Ok(blur_config) => {
            let settings_val = serde_json::to_value(&blur_config.settings)
                .map_err(|e| format!("Failed to serialize settings: {}", e))?;
            Ok(ConfigLoadResponse {
                ok: true,
                settings: Some(settings_val),
                error: None,
            })
        }
        Err(e) => Ok(ConfigLoadResponse {
            ok: false,
            settings: None,
            error: Some(e),
        }),
    }
}

#[tauri::command]
async fn list_blur_configs() -> Result<ConfigListResponse, String> {
    let configs = config::list_configs()?;

    Ok(ConfigListResponse {
        ok: true,
        configs: configs
            .iter()
            .map(|c| ConfigInfoResponse {
                name: c.name.clone(),
                description: c.description.clone(),
                is_preset: c.is_preset,
            })
            .collect(),
    })
}

#[tauri::command]
async fn delete_blur_config(name: String) -> Result<(), String> {
    validation::validate_string(&name, "name", 200)?;
    config::delete_config(&name)
}

// ===== MEDIA INFO =====

#[tauri::command]
async fn get_media_duration(path: String) -> Result<f64, String> {
    validation::validate_file_exists(&path, "path")?;
    let info = video_info::get_video_info(&path)?;
    Ok(info.duration)
}

// ===== COMPRESSION =====

#[tauri::command]
async fn compress_file(
    app: AppHandle,
    input: String,
    output: String,
    target_size_bytes: f64,
) -> Result<(), String> {
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;

    // Get video duration
    let info = video_info::get_video_info(&input)?;
    if info.duration <= 0.0 {
        return Err("Cannot determine video duration".to_string());
    }

    // Calculate target bitrate (bits per second)
    let target_bits = target_size_bytes * 8.0;
    let duration = info.duration;
    // Leave 5% for audio and container overhead
    let video_bitrate = (target_bits * 0.95) / duration;
    let video_bitrate_kbps = video_bitrate / 1000.0;

    let app_handle = app.clone();
    let input_clone = input.clone();
    let output_clone = output.clone();
    let ffmpeg = find_ffmpeg();
    let pass_id = format!("converter_2pass_{}", COMPRESS_COUNTER.fetch_add(1, Ordering::Relaxed));

    tokio::task::spawn_blocking(move || {
        let _ = app_handle.emit("convert-progress", 0);

        // Use a unique temp path per process to avoid races with concurrent compressions
        let passlogfile = std::env::temp_dir().join(&pass_id);
        let passlogfile_str = passlogfile.to_string_lossy().to_string();
        // Clean up any stale log files
        let _ = std::fs::remove_file(format!("{}.log", passlogfile_str));
        let _ = std::fs::remove_file(format!("{}.log.mbtree", passlogfile_str));

        // Two-pass encoding
        let pass1 = std::process::Command::new(&ffmpeg)
            .args([
                "-y",
                "-i",
                &input_clone,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-b:v",
                &format!("{}k", video_bitrate_kbps.round()),
                "-pass",
                "1",
                "-passlogfile",
                &passlogfile_str,
                "-an",
                "-f",
                "null",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
            ])
            .output()
            .map_err(|e| format!("Failed to start ffmpeg pass 1: {}", e))?;

        if !pass1.status.success() {
            let pass1_stderr = String::from_utf8_lossy(&pass1.stderr);
            eprintln!("[compress] ffmpeg pass 1 failed, falling back to single-pass: {}", pass1_stderr);
            // Clean up stale pass log files before fallback
            let _ = std::fs::remove_file(format!("{}.log", passlogfile_str));
            let _ = std::fs::remove_file(format!("{}.log.mbtree", passlogfile_str));
            let single = std::process::Command::new(&ffmpeg)
                .args([
                    "-y",
                    "-i",
                    &input_clone,
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-crf",
                    "23",
                    "-preset",
                    "medium",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    &output_clone,
                ])
                .output()
                .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

            if !single.status.success() {
                return Err(format!(
                    "ffmpeg failed: {}",
                    String::from_utf8_lossy(&single.stderr)
                ));
            }

            let _ = app_handle.emit("convert-progress", 100);
            let _ = app_handle.emit(
                "convert-finished",
                FinishedEvent {
                    ok: true,
                    message: String::new(),
                    file_path: output_clone,
                },
            );
            return Ok(());
        }

        let _ = app_handle.emit("convert-progress", 50);

        // Pass 2
        let pass2 = std::process::Command::new(&ffmpeg)
            .args([
                "-y",
                "-i",
                &input_clone,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-b:v",
                &format!("{}k", video_bitrate_kbps.round()),
                "-pass",
                "2",
                "-passlogfile",
                &passlogfile_str,
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                &output_clone,
            ])
            .output()
            .map_err(|e| format!("Failed to start ffmpeg pass 2: {}", e))?;

        if !pass2.status.success() {
            return Err(format!(
                "ffmpeg pass 2 failed: {}",
                String::from_utf8_lossy(&pass2.stderr)
            ));
        }

        // Clean up 2-pass log files
        let _ = std::fs::remove_file(format!("{}.log", passlogfile_str));
        let _ = std::fs::remove_file(format!("{}.log.mbtree", passlogfile_str));

        let _ = app_handle.emit("convert-progress", 100);
        let _ = app_handle.emit(
            "convert-finished",
            FinishedEvent {
                ok: true,
                message: String::new(),
                file_path: output_clone,
            },
        );

        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ===== APP SETTINGS =====

#[tauri::command]
async fn get_settings() -> Result<AppSettingsResponse, String> {
    let s = settings::load_settings()?;
    Ok(AppSettingsResponse::from(&s))
}

#[tauri::command]
async fn save_settings(
    download_dir: String,
    output_dir: String,
    auto_save: bool,
    overwrite_existing: bool,
) -> Result<AppSettingsResponse, String> {
    validation::validate_output_dir(&download_dir)?;
    validation::validate_output_dir(&output_dir)?;

    let s = AppSettings {
        download_dir,
        output_dir,
        auto_save,
        overwrite_existing,
    };
    settings::save_settings(&s)?;
    Ok(AppSettingsResponse::from(&s))
}

#[tauri::command]
async fn reset_settings() -> Result<AppSettingsResponse, String> {
    let s = settings::reset_settings()?;
    Ok(AppSettingsResponse::from(&s))
}

#[tauri::command]
async fn get_default_download_dir() -> Result<String, String> {
    Ok(settings::get_default_download_dir())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .manage(PythonEngine::new())
        .invoke_handler(tauri::generate_handler![
            detect_file,
            detect_url,
            start_convert,
            start_download,
            cancel_operation,
            detect_video_info,
            start_blur,
            get_weight_preview,
            get_encode_presets,
            get_quality_config,
            detect_gpu,
            save_blur_config,
            load_blur_config,
            list_blur_configs,
            delete_blur_config,
            get_media_duration,
            compress_file,
            get_settings,
            save_settings,
            reset_settings,
            get_default_download_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
