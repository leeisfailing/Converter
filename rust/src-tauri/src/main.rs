#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod linux_graphics;

fn main() {
    #[cfg(target_os = "linux")]
    {
        let session_type = std::env::var("XDG_SESSION_TYPE").ok();
        let wayland_display = std::env::var("WAYLAND_DISPLAY").ok();
        let gdk_backend = std::env::var("GDK_BACKEND").ok();
        if linux_graphics::needs_explicit_sync_workaround(
            std::path::Path::new("/sys/module/nvidia").is_dir(),
            session_type.as_deref(),
            wayland_display.as_deref(),
            gdk_backend.as_deref(),
            std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_some(),
        ) {
            // SAFETY: main is still single-threaded, before Tauri, GTK, or any
            // engine/runtime initialization can read or mutate the environment.
            unsafe { std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1") };
            eprintln!("Enabled NVIDIA Wayland explicit-sync workaround for WebKitGTK.");
        }
    }
    converter_lib::run()
}
