use crate::models::*;
use crate::validation;
use tauri::{AppHandle, Emitter, Manager};
use crate::engine::run_interactive_command;
use crate::blur::video_info;
use crate::paths::ffmpeg as find_ffmpeg;
use crate::process_output::CancellableCommand;

#[tauri::command]
pub async fn start_convert(
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
pub async fn start_download(
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

// ===== MEDIA INFO =====

#[tauri::command]
pub async fn get_media_duration(path: String) -> Result<f64, String> {
    validation::validate_file_exists(&path, "path")?;
    let info = tokio::task::spawn_blocking(move || video_info::get_video_info(&path)).await.map_err(|e| e.to_string())??;
    Ok(info.duration)
}

// ===== COMPRESSION =====

#[tauri::command]
pub async fn compress_file(
    app: AppHandle,
    input: String,
    output: String,
    target_size_bytes: f64,
) -> Result<(), String> {
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;

    // Get video duration
    let operation = app.state::<crate::operations::Operations>().begin()?;
    let probe_input = input.clone();
    let info = tokio::task::spawn_blocking(move || video_info::get_video_info(&probe_input)).await.map_err(|e| e.to_string())??;
    if info.duration <= 0.0 {
        return Err("Cannot determine video duration".to_string());
    }

    if !target_size_bytes.is_finite() || target_size_bytes <= 0.0 {
        return Err("Target size must be a positive, finite number".into());
    }

    // Calculate target bitrate (bits per second)
    let target_bits = target_size_bytes * 8.0;
    let duration = info.duration;
    // Reserve the actual 128 kbps audio bitrate and 2% container overhead.
    let video_bitrate = (target_bits * 0.98) / duration - 128_000.0;
    let video_bitrate_kbps = video_bitrate / 1000.0;
    if video_bitrate_kbps < 50.0 { return Err("Target size is too small for this duration and audio bitrate".into()); }

    let app_handle = app.clone();
    let input_clone = input.clone();
    let output_clone = output.clone();
    let ffmpeg = find_ffmpeg();

    tokio::task::spawn_blocking(move || {
        let _ = app_handle.emit("convert-progress", 0);

        // The whole pass directory is removed on success, cancellation, or failure.
        let pass_dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let passlogfile_str = pass_dir.path().join("stats").to_string_lossy().into_owned();

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
            .output_cancellable(&operation)
            .map_err(|e| format!("Failed to start ffmpeg pass 1: {}", e))?;

        if !pass1.status.success() {
            return Err(format!("ffmpeg pass 1 failed: {}", String::from_utf8_lossy(&pass1.stderr)));
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
            .output_cancellable(&operation)
            .map_err(|e| format!("Failed to start ffmpeg pass 2: {}", e))?;

        if !pass2.status.success() {
            return Err(format!(
                "ffmpeg pass 2 failed: {}",
                String::from_utf8_lossy(&pass2.stderr)
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

        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

