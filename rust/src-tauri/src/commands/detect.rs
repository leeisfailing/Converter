use crate::{engine, models::*, validation};
use tauri::AppHandle;

#[tauri::command]
pub async fn detect_file(app: AppHandle, path: String, dev_mode: bool) -> Result<DetectFileResponse, String> {
    validation::validate_file_exists(&path, "path")?;
    engine::request(&app, serde_json::json!({ "cmd": "detect_file", "path": path, "dev_mode": dev_mode })).await
}

#[tauri::command]
pub async fn detect_url(app: AppHandle, url: String) -> Result<DetectUrlResponse, String> {
    validation::validate_url(&url)?;
    engine::request(&app, serde_json::json!({ "cmd": "detect_url", "url": url })).await
}
