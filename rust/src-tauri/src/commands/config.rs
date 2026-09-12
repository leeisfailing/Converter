use crate::models::*;
use crate::{validation, settings};
use crate::blur::{config, settings::BlurSettings};
use crate::settings::AppSettings;

// ===== CONFIG COMMANDS =====

#[tauri::command]
pub async fn save_blur_config(
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
pub async fn load_blur_config(name: String) -> Result<ConfigLoadResponse, String> {
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
pub async fn list_blur_configs() -> Result<ConfigListResponse, String> {
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
pub async fn delete_blur_config(name: String) -> Result<(), String> {
    validation::validate_string(&name, "name", 200)?;
    config::delete_config(&name)
}

// ===== APP SETTINGS =====

#[tauri::command]
pub async fn get_settings() -> Result<AppSettingsResponse, String> {
    let s = settings::load_settings()?;
    Ok(AppSettingsResponse::from(&s))
}

#[tauri::command]
pub async fn save_settings(
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
pub async fn reset_settings() -> Result<AppSettingsResponse, String> {
    let s = settings::reset_settings()?;
    Ok(AppSettingsResponse::from(&s))
}

#[tauri::command]
pub async fn get_default_download_dir() -> Result<String, String> {
    Ok(settings::get_default_download_dir())
}

