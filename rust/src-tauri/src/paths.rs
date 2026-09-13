//! Resolve bundled/development tools once without launching version probes.
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[cfg(windows)]
fn executable(name: &str) -> Cow<'_, str> {
    Cow::Owned(format!("{name}.exe"))
}

#[cfg(not(windows))]
fn executable(name: &str) -> Cow<'_, str> {
    Cow::Borrowed(name)
}

pub fn project_root() -> &'static Path {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent().unwrap()
            .parent().unwrap()
            .to_path_buf()
    })
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
    Some(format!("{name}-{arch}-{platform}{}", if cfg!(windows) { ".exe" } else { "" }))
}

fn tool_roots() -> &'static [PathBuf] {
    static ROOTS: OnceLock<Vec<PathBuf>> = OnceLock::new();
    ROOTS.get_or_init(|| {
        let mut roots = Vec::with_capacity(8);
        if let Some(dir) = std::env::current_exe().ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
        {
            roots.push(dir.clone());
            roots.push(dir.join("Engine/bin"));
            roots.push(dir.join("resources/Engine/bin"));
        }
        roots.push(project_root().join("Engine/bin"));
        roots.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("bin"));
        roots
    })
}

fn find_in_roots(name: &str, roots: &[PathBuf]) -> Option<PathBuf> {
    let exe = executable(name);
    let mut names = vec![exe.into_owned()];
    if let Some(sidecar) = sidecar_filename(name) { names.push(sidecar); }
    roots.iter().flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| path.is_file())
}

fn resolve(name: &str) -> String {
    let mut roots = tool_roots().to_vec();
    if let Some(path) = std::env::var_os("PATH") {
        roots.extend(std::env::split_paths(&path));
    }
    find_in_roots(name, &roots)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| executable(name).into_owned())
}

pub fn ffmpeg() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| resolve("ffmpeg"))
}

pub fn ffprobe() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| resolve("ffprobe"))
}

pub fn vspipe() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        // The wheel's vspipe/vsscript pair locates its embedded Python without
        // consulting the registry. Prefer it over older standalone sidecars.
        tool_roots().iter()
            .map(|root| root.join("python/Lib/site-packages/vapoursynth").join(executable("vspipe").as_ref()))
            .find(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| resolve("vspipe"))
    })
}

pub fn vapoursynth_plugins() -> Option<PathBuf> {
    tool_roots().iter().map(|root| root.join("plugins"))
        .find(|path| path.is_dir())
}

pub fn python() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        if let Some(bundled) = find_bundled_python(tool_roots()) {
            return bundled.to_string_lossy().into_owned();
        }
        let names: &[&str] = if cfg!(windows) { &["python", "python3", "py"] } else { &["python3", "python"] };
        names.iter().map(|name| resolve(name)).find(|path| Path::new(path).is_file())
            .unwrap_or_else(|| names[0].to_string())
    })
}

fn find_bundled_python(roots: &[PathBuf]) -> Option<PathBuf> {
    roots.iter().map(|root| root.join("python").join(executable("python").as_ref()))
        .find(|path| path.is_file())
}

/// Resolve against Tauri's actual resource directory before any development or
/// system fallback (resource_dir is not necessarily beside current_exe).
pub fn python_in(resource_dir: &Path) -> String {
    find_bundled_python(&[resource_dir.join("Engine/bin")])
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| python().to_string())
}

/// Dev runs must not prefer stale resource copies in target/debug.
pub fn engine_runtime(resource_dir: &Path, project: &Path, development: bool) -> (PathBuf, String) {
    let source = project.join("Engine/__main__.py");
    if development && source.is_file() {
        let runtime = find_bundled_python(&[project.join("rust/src-tauri/bin")]);
        return (source, runtime.map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| python().to_string()));
    }
    let bundled = resource_dir.join("Engine/__main__.py");
    (if bundled.is_file() { bundled } else { source }, python_in(resource_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_uses_source_and_private_runtime_while_release_uses_bundle() {
        let project = tempfile::tempdir().unwrap();
        let resources = tempfile::tempdir().unwrap();
        let source = project.path().join("Engine/__main__.py");
        let copied = resources.path().join("Engine/__main__.py");
        let dev_python = project.path().join("rust/src-tauri/bin/python").join(executable("python").as_ref());
        let bundled_python = resources.path().join("Engine/bin/python").join(executable("python").as_ref());
        for file in [&source, &copied, &dev_python, &bundled_python] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, []).unwrap();
        }
        let (entry, runtime) = engine_runtime(resources.path(), project.path(), true);
        assert_eq!(entry, source);
        assert_eq!(PathBuf::from(runtime), dev_python);
        let (entry, runtime) = engine_runtime(resources.path(), project.path(), false);
        assert_eq!(entry, copied);
        assert_eq!(PathBuf::from(runtime), bundled_python);
    }

    #[test]
    fn resolves_installed_name_and_target_suffixed_source_name() {
        let root = tempfile::tempdir().unwrap();
        let Some(sidecar) = sidecar_filename("ffmpeg") else { return };
        let source = root.path().join(&sidecar);
        std::fs::write(&source, []).unwrap();
        let roots = [root.path().to_path_buf()];
        assert_eq!(find_in_roots("ffmpeg", &roots), Some(source));
        let installed = root.path().join(executable("ffmpeg").as_ref());
        std::fs::write(&installed, []).unwrap();
        assert_eq!(find_in_roots("ffmpeg", &roots), Some(installed));
    }

    #[test]
    fn installed_root_wins_over_later_development_root() {
        let installed = tempfile::tempdir().unwrap();
        let development = tempfile::tempdir().unwrap();
        let bundled = installed.path().join(executable("ffprobe").as_ref());
        std::fs::write(&bundled, []).unwrap();
        std::fs::write(development.path().join(executable("ffprobe").as_ref()), []).unwrap();
        assert_eq!(find_in_roots("ffprobe", &[installed.path().into(), development.path().into()]), Some(bundled));
    }

    #[test]
    fn python_uses_tauri_resource_directory_even_when_system_python_exists() {
        let resources = tempfile::tempdir().unwrap();
        let bundled = resources.path().join("Engine/bin/python").join(executable("python").as_ref());
        std::fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        std::fs::write(&bundled, []).unwrap();
        assert_eq!(PathBuf::from(python_in(resources.path())), bundled);
    }
}
