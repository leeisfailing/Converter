use crate::engine;
use crate::cpp_engine;
use crate::validation;
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn get_concurrency(app: AppHandle) -> Result<crate::operations::ConcurrencySnapshot, String> {
    let ops = app.state::<crate::operations::Operations>();
    Ok(ops.snapshot())
}

// Sidecars use use_gpu for automatic selection and preferred_encoder for
// explicit hardware selection. Translate the UI choice at this boundary.
fn sidecar_encoder_selection(use_gpu: bool, preferred: String, selected: &str) -> (bool, String) {
    if use_gpu && !selected.is_empty() {
        (false, selected.to_owned())
    } else {
        (use_gpu, preferred)
    }
}

#[derive(Serialize)]
struct ConvertRequest<'a> {
    id: &'a str,
    cmd: &'static str,
    input: &'a str,
    output: &'a str,
    format: &'a str,
    dev_mode: bool,
    use_gpu: bool,
    preferred_encoder: String,
    selected_gpu: &'a str,
}

#[derive(Serialize)]
struct DownloadRequest<'a> {
    id: &'a str,
    cmd: &'static str,
    url: &'a str,
    format_type: &'a str,
    output_dir: &'a str,
    write_subtitles: bool,
    write_thumbnail: bool,
    use_browser_cookies: bool,
}

#[derive(Serialize)]
struct TranscoderRequest<'a> {
    id: &'a str,
    cmd: &'static str,
    input: &'a str,
    output: &'a str,
    quality: u8,
    target_bytes: Option<u64>,
    file_type: &'a str,
    use_gpu: bool,
    preferred_encoder: String,
    selected_gpu: &'a str,
}

#[derive(Serialize)]
struct UpscaleRequest<'a> {
    id: &'a str,
    cmd: &'static str,
    input: &'a str,
    output: &'a str,
    target: &'a str,
    file_type: &'a str,
    use_gpu: bool,
    preferred_encoder: String,
    selected_gpu: &'a str,
}

#[derive(Serialize)]
struct EnhanceRequest<'a> {
    id: &'a str,
    cmd: &'static str,
    input: &'a str,
    output: &'a str,
    file_type: &'a str,
    model: &'a str,
    tile_size: u32,
    use_gpu: bool,
    selected_gpu: &'a str,
}

#[tauri::command]
pub async fn start_convert(
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
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;
    validation::validate_string(&format, "format", 64)?;

    let gpu_str = selected_gpu.unwrap_or_default();
    let (use_gpu, preferred_encoder) = sidecar_encoder_selection(use_gpu, preferred_encoder, &gpu_str);
    let req = ConvertRequest { id: &id, cmd: "start_convert", input: &input, output: &output, format: &format, dev_mode, use_gpu, preferred_encoder, selected_gpu: &gpu_str };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    if cpp_engine::binary_path().is_some() {
        cpp_engine::run_interactive_command(app, cmd_json, "convert", id).await
    } else {
        engine::run_interactive_command(app, cmd_json, "convert", id).await
    }
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    id: String,
    url: String,
    format_type: String,
    output_dir: String,
    write_subtitles: Option<bool>,
    write_thumbnail: Option<bool>,
    use_browser_cookies: Option<bool>,
) -> Result<(), String> {
    validation::validate_url(&url)?;
    validation::validate_string(&format_type, "format_type", 64)?;
    validation::validate_output_dir(&output_dir)?;

    let req = DownloadRequest {
        id: &id,
        cmd: "start_download",
        url: &url,
        format_type: &format_type,
        output_dir: &output_dir,
        write_subtitles: write_subtitles.unwrap_or(false),
        write_thumbnail: write_thumbnail.unwrap_or(false),
        use_browser_cookies: use_browser_cookies.unwrap_or(false),
    };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    engine::run_interactive_command(app, cmd_json, "download", id).await
}

#[tauri::command]
pub async fn start_transcoder(
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
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;
    if target_bytes.is_some_and(|size| size == 0 || size > 10_000_000_000) {
        return Err("Target size must be greater than zero and at most 10 GB".into());
    }
    if quality == 0 || quality > 100 {
        return Err("quality must be between 1 and 100".to_string());
    }
    if !matches!(file_type.as_str(), "video" | "photo" | "audio") {
        return Err("file_type must be one of: video, photo, audio".to_string());
    }

    let gpu_str = selected_gpu.unwrap_or_default();
    let (use_gpu, preferred_encoder) = sidecar_encoder_selection(use_gpu, preferred_encoder, &gpu_str);
    let req = TranscoderRequest { id: &id, cmd: "start_transcoder", input: &input, output: &output, quality, target_bytes, file_type: &file_type, use_gpu, preferred_encoder, selected_gpu: &gpu_str };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    if target_bytes.is_none() && cpp_engine::binary_path().is_some() {
        cpp_engine::run_interactive_command(app, cmd_json, "transcoder", id).await
    } else {
        engine::run_interactive_command(app, cmd_json, "transcoder", id).await
    }
}

#[tauri::command]
pub async fn start_upscale(
    app: AppHandle,
    id: String,
    input: String,
    output: String,
    target: String,
    file_type: String,
    use_gpu: bool,
    preferred_encoder: String,
    selected_gpu: Option<String>,
) -> Result<(), String> {
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;
    if !matches!(target.as_str(), "2k" | "4k" | "8k" | "16k") {
        return Err("target must be one of: 2k, 4k, 8k, 16k".to_string());
    }
    if !matches!(file_type.as_str(), "video" | "photo") {
        return Err("file_type must be one of: video, photo".to_string());
    }

    let gpu_str = selected_gpu.unwrap_or_default();
    let (use_gpu, preferred_encoder) = sidecar_encoder_selection(use_gpu, preferred_encoder, &gpu_str);
    let req = UpscaleRequest { id: &id, cmd: "start_upscale", input: &input, output: &output, target: &target, file_type: &file_type, use_gpu, preferred_encoder, selected_gpu: &gpu_str };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    if cpp_engine::binary_path().is_some() {
        cpp_engine::run_interactive_command(app, cmd_json, "upscale", id).await
    } else {
        engine::run_interactive_command(app, cmd_json, "upscale", id).await
    }
}

#[tauri::command]
pub async fn start_enhance(
    app: AppHandle,
    id: String,
    input: String,
    output: String,
    file_type: String,
    model: String,
    tile_size: u32,
    use_gpu: bool,
    selected_gpu: Option<String>,
) -> Result<(), String> {
    validation::validate_file_exists(&input, "input")?;
    validation::validate_output_path(&output, "output")?;
    if !matches!(file_type.as_str(), "video" | "photo") {
        return Err("file_type must be one of: video, photo".to_string());
    }
    if !matches!(model.as_str(), "realesrgan-x4plus" | "realesrgan-x2plus" | "realesr-general-x4v3") {
        return Err("model must be one of: realesrgan-x4plus, realesrgan-x2plus, realesr-general-x4v3".to_string());
    }
    if tile_size < 64 || tile_size > 512 {
        return Err("tile_size must be between 64 and 512".to_string());
    }

    let gpu_str = selected_gpu.unwrap_or_default();
    let req = EnhanceRequest {
        id: &id,
        cmd: "start_enhance",
        input: &input,
        output: &output,
        file_type: &file_type,
        model: &model,
        tile_size,
        use_gpu,
        selected_gpu: &gpu_str,
    };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    engine::run_interactive_command(app, cmd_json, "enhance", id).await
}

#[cfg(test)]
mod gpu_selection_tests {
    use super::sidecar_encoder_selection;

    #[test]
    fn manual_gpu_reaches_sidecar_as_explicit_encoder() {
        assert_eq!(sidecar_encoder_selection(true, String::new(), "h264_amf"), (false, "h264_amf".into()));
        assert_eq!(sidecar_encoder_selection(true, String::new(), ""), (true, String::new()));
        assert_eq!(sidecar_encoder_selection(false, String::new(), "h264_amf"), (false, String::new()));
    }
}
