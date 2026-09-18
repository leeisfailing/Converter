#![recursion_limit = "256"]
#![allow(dead_code)]
#![allow(clippy::module_inception)]

use tauri::Manager;

mod cache;
mod commands;
mod cpp_engine;
mod engine;
mod media_engine;
mod models;
mod operations;
mod paths;
mod persistent_cache;
mod plugin_system;
mod process_output;
mod settings;
mod system_specs;
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
            // Auto-load plugins from PyEngine/plugins directory
            if let Ok(resource_dir) = app.handle().path().resource_dir() {
                let plugin_dir = resource_dir.join("PyEngine/plugins");
                if plugin_dir.is_dir() {
                    let loaded = plugin_system::PluginRegistry::global().load_dir(&plugin_dir);
                    for info in &loaded {
                        if info.loaded {
                            log::info!("Loaded plugin: {} v{}", info.name, info.version);
                        } else if let Some(err) = &info.error {
                            log::warn!("Plugin {} failed: {}", info.name, err);
                        }
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("Window close requested — cancelling all operations");
                // Cancel all operation flags immediately
                if let Some(ops) = window.try_state::<operations::Operations>() {
                    ops.cancel_all();
                    log::info!("All operation flags set to cancelled");
                }
                // Kill any running engine processes
                let handle = window.app_handle().clone();
                tokio::spawn(async move {
                    // Kill Python engine process
                    if let Some(py_engine) = handle.try_state::<engine::PythonEngine>() {
                        py_engine.shutdown().await;
                    }
                    // Kill C++ engine process
                    if let Some(cpp_engine) = handle.try_state::<cpp_engine::CppEngine>() {
                        cpp_engine.shutdown().await;
                    }
                    // Flush persistent cache to disk
                    persistent_cache::PersistentCache::global().flush().await;
                    log::info!("All engine processes killed, cache flushed");
                });
            }
        })
        .manage(engine::PythonEngine::default())
        .manage(cpp_engine::CppEngine::default())
        .manage(operations::Operations::from_limits(&system_specs::compute_concurrency()))
        .manage(cache::AppCache::default())
        .manage(persistent_cache::PersistentCache::global().clone())
        .invoke_handler(tauri::generate_handler![
            // Existing commands (Python engine fallback)
            commands::detect::detect_file,
            commands::detect::detect_url,
            commands::detect::detect_gpu,
            commands::media::start_convert,
            commands::media::start_download,
            commands::media::start_transcoder,
            commands::media::start_upscale,
            commands::media::start_enhance,
            engine::cancel_operation,
            engine::cancel_operation_by_id,
            cpp_engine::cancel_cpp_operation,
            commands::config::get_settings,
            commands::config::save_settings,
            commands::config::reset_settings,
            commands::config::get_default_download_dir,
            commands::config::get_default_output_dir,
            cache::get_cache_stats,
            cache::clear_cache,
            commands::media::get_concurrency,
            system_specs::check_upscale,
            persistent_cache::get_persistent_cache_stats,
            persistent_cache::clear_persistent_cache,
            // Native Rust engine
            media_engine::probe_file,
            media_engine::detect_gpus_native,
            media_engine::start_convert_native,
            media_engine::start_transcoder_native,
            // C ABI plugin system
            plugin_system::plugin_list,
            plugin_system::plugin_load,
            plugin_system::plugin_unload,
            plugin_system::plugin_process,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
