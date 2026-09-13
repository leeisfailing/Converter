use crate::models::*;
use crate::settings::AppSettings;
use crate::{settings, validation};

#[tauri::command]
pub async fn get_settings() -> Result<AppSettingsResponse, String> {
    let s = tokio::task::spawn_blocking(settings::load_settings)
        .await
        .map_err(|e| format!("Task failed: {e}"))??;
    settings::ensure_default_dirs(&s)?;
    Ok(s.into())
}

#[tauri::command]
pub async fn save_settings(
    download_dir: String,
    output_dir: String,
    use_gpu: bool,
    preferred_encoder: String,
) -> Result<AppSettingsResponse, String> {
    validation::validate_output_dir(&download_dir)?;
    validation::validate_output_dir(&output_dir)?;

    let s = AppSettings { download_dir, output_dir, use_gpu, preferred_encoder };
    let settings = s.clone();
    tokio::task::spawn_blocking(move || settings::save_settings(&settings))
        .await
        .map_err(|e| format!("Task failed: {e}"))??;
    settings::ensure_default_dirs(&s)?;
    Ok(s.into())
}

#[tauri::command]
pub async fn reset_settings() -> Result<AppSettingsResponse, String> {
    let s = tokio::task::spawn_blocking(settings::reset_settings)
        .await
        .map_err(|e| format!("Task failed: {e}"))??;
    Ok(s.into())
}

#[tauri::command]
pub async fn get_default_download_dir() -> Result<String, String> {
    Ok(settings::get_default_download_dir())
}

#[tauri::command]
pub async fn get_default_output_dir() -> Result<String, String> {
    Ok(settings::get_default_output_dir())
}
