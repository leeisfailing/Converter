//! Identify distributions that support the signed automatic updater.
use std::path::Path;
use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DistributionKind {
    WindowsInstaller,
    LinuxAppimage,
    Unsupported,
}

const PORTABLE_MARKER: &str = "converter-portable.json";

fn classify_distribution(platform: &str, appimage: Option<&Path>, executable: Option<&Path>) -> DistributionKind {
    match platform {
        // Portable ZIPs require manual replacement. Installing NSIS over one
        // would leave the original portable copy behind.
        "windows" if executable.and_then(Path::parent)
            .is_some_and(|directory| directory.join(PORTABLE_MARKER).is_file()) => DistributionKind::Unsupported,
        "windows" => DistributionKind::WindowsInstaller,
        "linux" if appimage.is_some_and(Path::is_file) => DistributionKind::LinuxAppimage,
        _ => DistributionKind::Unsupported,
    }
}

#[tauri::command]
pub fn get_update_distribution() -> DistributionKind {
    let appimage = std::env::var_os("APPIMAGE").map(std::path::PathBuf::from);
    let executable = std::env::current_exe().ok();
    classify_distribution(std::env::consts::OS, appimage.as_deref(), executable.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_requires_existing_appimage_file() {
        let image = tempfile::NamedTempFile::new().unwrap();
        assert_eq!(classify_distribution("linux", Some(image.path()), None), DistributionKind::LinuxAppimage);
        assert_eq!(classify_distribution("linux", None, None), DistributionKind::Unsupported);
        assert_eq!(classify_distribution("linux", Some(Path::new("/missing/Converter.AppImage")), None), DistributionKind::Unsupported);
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(classify_distribution("linux", Some(directory.path()), None), DistributionKind::Unsupported);
    }

    #[test]
    fn windows_keeps_existing_update_behavior() {
        assert_eq!(classify_distribution("windows", None, None), DistributionKind::WindowsInstaller);
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("converter.exe");
        assert_eq!(classify_distribution("windows", None, Some(&executable)), DistributionKind::WindowsInstaller);
    }

    #[test]
    fn windows_portable_marker_disables_installer_updates() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("converter.exe");
        std::fs::write(directory.path().join(PORTABLE_MARKER), "{\"distribution\":\"portable\"}").unwrap();
        assert_eq!(classify_distribution("windows", None, Some(&executable)), DistributionKind::Unsupported);
        assert_eq!(classify_distribution("linux", None, Some(&executable)), DistributionKind::Unsupported);
    }

    #[test]
    fn marker_must_be_a_file_beside_the_executable() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("converter.exe");
        std::fs::create_dir(directory.path().join(PORTABLE_MARKER)).unwrap();
        assert_eq!(classify_distribution("windows", None, Some(&executable)), DistributionKind::WindowsInstaller);
    }
}
