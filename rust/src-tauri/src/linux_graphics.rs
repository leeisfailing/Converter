// NVIDIA + Wayland can crash WebKitGTK with GDK Error 71. Keep hardware
// acceleration enabled using Tauri's first environment workaround:
// https://v2.tauri.app/develop/debug/linux-graphics/
pub fn needs_explicit_sync_workaround(
    nvidia_driver_loaded: bool,
    session_type: Option<&str>,
    wayland_display: Option<&str>,
    gdk_backend: Option<&str>,
    explicit_sync_override_present: bool,
) -> bool {
    if !nvidia_driver_loaded || explicit_sync_override_present {
        return false;
    }

    // GDK tries explicitly requested backends in order. Do not change an X11
    // launch just because it runs inside a Wayland desktop session.
    if let Some(backend) = gdk_backend {
        match backend.split(',').next().map(str::trim) {
            Some("wayland") => return true,
            Some("*") => {}
            _ => return false,
        }
    }

    session_type == Some("wayland")
        || wayland_display.is_some_and(|display| !display.is_empty())
}

#[cfg(test)]
mod tests {
    use super::needs_explicit_sync_workaround;

    #[test]
    fn only_applies_to_nvidia_wayland() {
        for nvidia in [false, true] {
            for session in [None, Some("x11"), Some("wayland")] {
                assert_eq!(
                    needs_explicit_sync_workaround(nvidia, session, None, None, false),
                    nvidia && session == Some("wayland"),
                );
            }
        }
    }

    #[test]
    fn supports_wayland_display_without_session_type() {
        assert!(needs_explicit_sync_workaround(true, None, Some("wayland-0"), None, false));
        assert!(!needs_explicit_sync_workaround(true, None, Some(""), None, false));
    }

    #[test]
    fn respects_explicit_sync_override_including_empty_value() {
        // Presence is checked with var_os, so "0", "1", empty and non-UTF8
        // values all count as an explicit user choice.
        assert!(!needs_explicit_sync_workaround(true, Some("wayland"), None, None, true));
    }

    #[test]
    fn respects_gdk_backend_selection_order() {
        for backend in ["x11", "x11,wayland", "broadway", ""] {
            assert!(!needs_explicit_sync_workaround(
                true, Some("wayland"), Some("wayland-0"), Some(backend), false,
            ));
        }
        for backend in ["wayland", "wayland,x11", " wayland ,x11", "*"] {
            assert!(needs_explicit_sync_workaround(
                true, Some("wayland"), None, Some(backend), false,
            ));
        }
        assert!(needs_explicit_sync_workaround(true, None, None, Some("wayland"), false));
        assert!(!needs_explicit_sync_workaround(true, None, None, Some("*"), false));
    }
}
