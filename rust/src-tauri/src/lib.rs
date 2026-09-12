#![recursion_limit = "256"]
#![allow(clippy::module_inception)]

mod blur;
mod commands;
mod engine;
mod models;
mod operations;
mod paths;
mod process_output;
mod settings;
mod validation;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .manage(engine::PythonEngine::default())
        .manage(operations::Operations::default())
        .invoke_handler(tauri::generate_handler![
            commands::detect::detect_file,
            commands::detect::detect_url,
            commands::media::start_convert,
            commands::media::start_download,
            engine::cancel_operation,
            commands::blur::detect_video_info,
            commands::blur::start_blur,
            commands::blur::get_weight_preview,
            commands::blur::get_encode_presets,
            commands::blur::get_quality_config,
            commands::blur::detect_gpu,
            commands::config::save_blur_config,
            commands::config::load_blur_config,
            commands::config::list_blur_configs,
            commands::config::delete_blur_config,
            commands::media::get_media_duration,
            commands::media::compress_file,
            commands::config::get_settings,
            commands::config::save_settings,
            commands::config::reset_settings,
            commands::config::get_default_download_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
