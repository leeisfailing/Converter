use crate::{engine, models::*, validation};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
struct DetectFileRequest<'a> {
    cmd: &'static str,
    path: &'a str,
    dev_mode: bool,
}

#[derive(Serialize)]
struct DetectUrlRequest<'a> {
    cmd: &'static str,
    url: &'a str,
}

#[tauri::command]
pub async fn detect_file(app: AppHandle, path: String, dev_mode: bool) -> Result<DetectFileResponse, String> {
    validation::validate_file_exists(&path, "path")?;
    let req = DetectFileRequest { cmd: "detect_file", path: &path, dev_mode };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    engine::request(&app, cmd_json).await
}

#[tauri::command]
pub async fn detect_url(app: AppHandle, url: String) -> Result<DetectUrlResponse, String> {
    validation::validate_url(&url)?;
    let req = DetectUrlRequest { cmd: "detect_url", url: &url };
    let cmd_json = serde_json::to_value(req).map_err(|e| e.to_string())?;
    engine::request(&app, cmd_json).await
}
