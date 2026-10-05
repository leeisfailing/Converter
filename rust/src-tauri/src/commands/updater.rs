//! Detect whether Linux is running from an updateable AppImage.
use std::path::Path;
use serde::Serialize;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DistributionKind {
    WindowsInstaller,
    LinuxAppimage,
    Unsupported,
}

fn classify_distribution(platform: &str, appimage: Option<&Path>) -> DistributionKind {
    match platform {
        // Preserve the existing Windows updater behavior. Windows packaging
        // and distribution detection are maintained separately.
        "windows" => DistributionKind::WindowsInstaller,
        "linux" if appimage.is_some_and(Path::is_file) => DistributionKind::LinuxAppimage,
        _ => DistributionKind::Unsupported,
    }
}

#[tauri::command]
pub fn get_update_distribution() -> DistributionKind {
    let appimage = std::env::var_os("APPIMAGE").map(std::path::PathBuf::from);
    classify_distribution(std::env::consts::OS, appimage.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_requires_existing_appimage_file() {
        let image = tempfile::NamedTempFile::new().unwrap();
        assert_eq!(classify_distribution("linux", Some(image.path())), DistributionKind::LinuxAppimage);
        assert_eq!(classify_distribution("linux", None), DistributionKind::Unsupported);
        assert_eq!(classify_distribution("linux", Some(Path::new("/missing/Converter.AppImage"))), DistributionKind::Unsupported);
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(classify_distribution("linux", Some(directory.path())), DistributionKind::Unsupported);
    }

    #[test]
    fn windows_keeps_existing_update_behavior() {
        assert_eq!(classify_distribution("windows", None), DistributionKind::WindowsInstaller);
    }
}
