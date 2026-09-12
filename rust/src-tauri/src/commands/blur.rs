use crate::models::*;
use crate::validation;
use tauri::{AppHandle, Emitter, Manager};
use crate::blur::{settings::BlurSettings, video_info, renderer, weighting, presets, gpu};

// ===== BLUR COMMANDS =====

#[tauri::command]
pub async fn detect_video_info(path: String) -> Result<VideoInfoResponse, String> {
    validation::validate_file_exists(&path, "path")?;
    let info = tokio::task::spawn_blocking(move || video_info::get_video_info(&path)).await.map_err(|e| e.to_string())??;

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
pub async fn start_blur(
    app: AppHandle,
    input: String,
    output: String,
    settings_json: serde_json::Value,
) -> Result<(), String> {
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;
    validation::validate_json_value(&settings_json, 10)?;

    let settings: BlurSettings = serde_json::from_value(settings_json)
        .map_err(|e| format!("Invalid settings: {}", e))?;

    validation::validate_ffmpeg_override(&settings.advanced.ffmpeg_override)?;

    if settings.blur_amount < 0.0 || settings.blur_amount > 10.0 {
        return Err("blur_amount must be between 0 and 10".to_string());
    }
    if settings.blur_output_fps < 1 || settings.blur_output_fps > 120 {
        return Err("blur_output_fps must be between 1 and 120".to_string());
    }
    if settings.interpolated_fps.parse::<i32>().unwrap_or(0) < 1 || settings.interpolated_fps.parse::<i32>().unwrap_or(0) > 960 {
        return Err("interpolated_fps must be between 1 and 960".to_string());
    }
    if settings.input_timescale < 0.1 || settings.input_timescale > 10.0 {
        return Err("input_timescale must be between 0.1 and 10".to_string());
    }
    if settings.output_timescale < 0.1 || settings.output_timescale > 10.0 {
        return Err("output_timescale must be between 0.1 and 10".to_string());
    }
    if settings.quality < 0 || settings.quality > 100 {
        return Err("quality must be between 0 and 100".to_string());
    }

    validation::validate_weighting(&settings.blur_weighting)?;
    if !settings.advanced.blur_weighting_gaussian_bound.is_empty() {
        validation::validate_gaussian_bound(&settings.advanced.blur_weighting_gaussian_bound)?;
    }

    let operation = app.state::<crate::operations::Operations>().begin()?;
    let probe_input = input.clone();
    let video_info = tokio::task::spawn_blocking(move || video_info::get_video_info(&probe_input)).await.map_err(|e| e.to_string())??;

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
            &operation,
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
pub async fn get_weight_preview(
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
    validation::validate_weighting(&blur_weighting)?;
    if blur_amount < 0.0 || blur_amount > 10.0 {
        return Err("blur_amount must be between 0 and 10".to_string());
    }
    if video_fps <= 0.0 || video_fps > 1000.0 {
        return Err("video_fps must be positive and <= 1000".to_string());
    }
    if output_fps <= 0.0 || output_fps > 1000.0 {
        return Err("output_fps must be positive and <= 1000".to_string());
    }
    if !gaussian_std_dev.is_finite() || gaussian_std_dev <= 0.0 {
        return Err("gaussian_std_dev must be positive".to_string());
    }
    if !gaussian_mean.is_finite() {
        return Err("gaussian_mean must be finite".to_string());
    }
    validation::validate_gaussian_bound(&gaussian_bound)?;

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
pub async fn get_encode_presets(gpu_type: String) -> Result<PresetListResponse, String> {
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
pub async fn get_quality_config(codec: String) -> Result<QualityConfigResponse, String> {
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
pub async fn detect_gpu() -> Result<GpuInfoResponse, String> {
    let info = tokio::task::spawn_blocking(gpu::detect_gpu_type).await.map_err(|e| e.to_string())?;

    Ok(GpuInfoResponse {
        ok: true,
        gpu_type: info.gpu_type,
        has_hardware_encoder: info.has_hardware_encoder,
    })
}

