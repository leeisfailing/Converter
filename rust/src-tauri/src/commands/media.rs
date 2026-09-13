use crate::engine::run_interactive_command;
use crate::validation;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
struct ConvertRequest<'a> {
    cmd: &'static str,
    input: &'a str,
    output: &'a str,
    format: &'a str,
    dev_mode: bool,
}

#[derive(Serialize)]
struct DownloadRequest<'a> {
    cmd: &'static str,
    url: &'a str,
    format_type: &'a str,
    output_dir: &'a str,
}

#[derive(Serialize)]
struct ReduceRequest<'a> {
    cmd: &'static str,
    input: &'a str,
    output: &'a str,
    quality: u8,
    target_bytes: Option<u64>,
    max_width: Option<u32>,
    file_type: &'a str,
}

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

    let req = ConvertRequest { cmd: "start_convert", input: &input, output: &output, format: &format, dev_mode };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
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

    let req = DownloadRequest { cmd: "start_download", url: &url, format_type: &format_type, output_dir: &output_dir };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    run_interactive_command(app, cmd_json, "download").await
}

#[tauri::command]
pub async fn start_reduce(
    app: AppHandle,
    input: String,
    output: String,
    quality: u8,
    target_bytes: Option<u64>,
    max_width: Option<u32>,
    file_type: String,
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

    let req = ReduceRequest { cmd: "start_reduce", input: &input, output: &output, quality, target_bytes, max_width, file_type: &file_type };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    run_interactive_command(app, cmd_json, "reduce").await
}
