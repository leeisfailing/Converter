//! Resolve bundled/development tools once without launching version probes.
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn executable(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

pub fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf()
}

// Tauri removes the target triple when it installs an externalBin. The source
// files retain it, so development builds must consider both names.
fn sidecar_filename(name: &str) -> Option<String> {
    let arch = if cfg!(target_arch = "x86_64") { "x86_64" }
        else if cfg!(target_arch = "aarch64") { "aarch64" }
        else if cfg!(target_arch = "x86") { "i686" }
        else { return None };
    let platform = if cfg!(target_os = "windows") {
        if cfg!(target_env = "gnu") { "pc-windows-gnu" } else { "pc-windows-msvc" }
    } else if cfg!(target_os = "macos") { "apple-darwin" }
    else if cfg!(target_os = "linux") {
        if cfg!(target_env = "musl") { "unknown-linux-musl" } else { "unknown-linux-gnu" }
    } else { return None };
    Some(executable(&format!("{name}-{arch}-{platform}")))
}

fn tool_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        roots.extend([
            dir.clone(),
            dir.join("Engine/bin"),
            dir.join("resources/Engine/bin"),
        ]);
    }
    roots.push(project_root().join("Engine/bin"));
    roots.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("bin"));
    roots
}

fn find_in_roots(name: &str, roots: &[PathBuf]) -> Option<PathBuf> {
    let mut names = vec![executable(name)];
    if let Some(sidecar) = sidecar_filename(name) { names.push(sidecar); }
    roots.iter().flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| path.is_file())
}

fn resolve(name: &str) -> String {
    let mut roots = tool_roots();
    if let Some(path) = std::env::var_os("PATH") { roots.extend(std::env::split_paths(&path)); }
    find_in_roots(name, &roots)
        .map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| executable(name))
}

pub fn ffmpeg() -> String {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| resolve("ffmpeg")).clone()
}
pub fn ffprobe() -> String {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| resolve("ffprobe")).clone()
}
pub fn vspipe() -> String {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        // The wheel's vspipe/vsscript pair locates its embedded Python without
        // consulting the registry. Prefer it over older standalone sidecars.
        tool_roots().iter()
            .map(|root| root.join("python/Lib/site-packages/vapoursynth").join(executable("vspipe")))
            .find(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| resolve("vspipe"))
    }).clone()
}

pub fn vapoursynth_plugins() -> Option<PathBuf> {
    tool_roots().iter().map(|root| root.join("plugins"))
        .find(|path| path.is_dir())
}
pub fn python() -> String {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        if let Some(bundled) = find_bundled_python(&tool_roots()) {
            return bundled.to_string_lossy().into_owned();
        }
        let names: &[&str] = if cfg!(windows) { &["python", "python3", "py"] } else { &["python3", "python"] };
        names.iter().map(|name| resolve(name)).find(|path| Path::new(path).is_file())
            .unwrap_or_else(|| names[0].to_string())
    }).clone()
}

fn find_bundled_python(roots: &[PathBuf]) -> Option<PathBuf> {
    roots.iter().map(|root| root.join("python").join(executable("python")))
        .find(|path| path.is_file())
}

/// Resolve against Tauri's actual resource directory before any development or
/// system fallback (resource_dir is not necessarily beside current_exe).
pub fn python_in(resource_dir: &Path) -> String {
    find_bundled_python(&[resource_dir.join("Engine/bin")])
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(python)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_installed_name_and_target_suffixed_source_name() {
        let root = tempfile::tempdir().unwrap();
        let Some(sidecar) = sidecar_filename("ffmpeg") else { return };
        let source = root.path().join(sidecar);
        std::fs::write(&source, []).unwrap();
        let roots = [root.path().to_path_buf()];
        assert_eq!(find_in_roots("ffmpeg", &roots), Some(source));
        let installed = root.path().join(executable("ffmpeg"));
        std::fs::write(&installed, []).unwrap();
        assert_eq!(find_in_roots("ffmpeg", &roots), Some(installed));
    }

    #[test]
    fn installed_root_wins_over_later_development_root() {
        let installed = tempfile::tempdir().unwrap();
        let development = tempfile::tempdir().unwrap();
        let bundled = installed.path().join(executable("ffprobe"));
        std::fs::write(&bundled, []).unwrap();
        std::fs::write(development.path().join(executable("ffprobe")), []).unwrap();
        assert_eq!(find_in_roots("ffprobe", &[installed.path().into(), development.path().into()]), Some(bundled));
    }

    #[test]
    fn python_uses_tauri_resource_directory_even_when_system_python_exists() {
        let resources = tempfile::tempdir().unwrap();
        let bundled = resources.path().join("Engine/bin/python").join(executable("python"));
        std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        std::fs::write(&bundled, []).unwrap();
        assert_eq!(PathBuf::from(python_in(resources.path())), bundled);
    }
}
