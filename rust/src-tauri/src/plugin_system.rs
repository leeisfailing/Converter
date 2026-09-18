//! Language-agnostic plugin system via C ABI.
//!
//! Any language that can produce a shared library (.dll/.so/.dylib) with
//! C-compatible function signatures can extend the engine:
//!
//! - C / C++ (native performance)
//! - Go (via `//export` cgo)
//! - Rust (via `#[no_mangle] extern "C"`)
//! - Python (via ctypes/cffi)
//! - Zig, Nim, D, etc.
//!
//! # Plugin API
//!
//! Required symbols:
//! ```c
//! const char* plugin_name(void);        // Human-readable name
//! int32_t     plugin_process(           // Process a media file
//!                const char* input_path,
//!                const char* output_path,
//!                const char* options_json,
//!                void (*progress_cb)(float));
//! ```
//!
//! Optional symbols:
//! ```c
//! const char* plugin_version(void);     // Semver string (defaults to "0.0.0")
//! int32_t     plugin_init(void);        // Returns 0 on success (skipped if absent)
//! void        plugin_shutdown(void);    // Cleanup (skipped if absent)
//! const char* plugin_config(void);      // Returns JSON describing capabilities
//! ```

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    ffi::{CStr, CString},
    os::raw::{c_char, c_int},
    path::{Path, PathBuf},
    sync::{OnceLock, RwLock},
};

// ── C ABI function pointer types ───────────────────────────────────────────

type PluginNameFn = extern "C" fn() -> *const c_char;
type PluginVersionFn = extern "C" fn() -> *const c_char;
type PluginInitFn = extern "C" fn() -> c_int;
type PluginProcessFn = extern "C" fn(
    input_path: *const c_char,
    output_path: *const c_char,
    options_json: *const c_char,
    progress_cb: Option<extern "C" fn(f32)>,
) -> c_int;
type PluginShutdownFn = extern "C" fn();
type PluginConfigFn = extern "C" fn() -> *const c_char;

/// The ABI guarantees a live, NUL-terminated string for non-null pointers.
unsafe fn plugin_string(pointer: *const c_char) -> Option<String> {
    if pointer.is_null() { return None; }
    Some(unsafe { CStr::from_ptr(pointer) }.to_string_lossy().into_owned())
}

// ── Plugin config / capabilities ───────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginConfig {
    /// Human-readable description of the plugin.
    #[serde(default)]
    pub description: String,
    /// MIME types or file extensions this plugin can handle (e.g. ["mp4", "webm"]).
    #[serde(default)]
    pub supported_formats: Vec<String>,
    /// Arbitrary key-value capabilities (e.g. {"supports_batch": true}).
    #[serde(default)]
    pub capabilities: HashMap<String, serde_json::Value>,
}

// ── Plugin metadata ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub path: PathBuf,
    pub loaded: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub config: PluginConfig,
}

// ── Loaded plugin wrapper ──────────────────────────────────────────────────

struct PluginVtable {
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    version: String,
    init: Option<PluginInitFn>,
    process: PluginProcessFn,
    shutdown: Option<PluginShutdownFn>,
    #[allow(dead_code)]
    config_fn: Option<PluginConfigFn>,
}

// SAFETY: PluginVtable holds function pointers resolved from a loaded shared library.
// The caller guarantees that the library remains loaded (held by `_lib` in LoadedPlugin)
// for the entire lifetime of the vtable. The function pointers themselves are plain
// addresses and do not carry mutable interior state; Send/Sync is safe because the
// actual concurrency constraints are enforced by the shared library's own ABI contract.
unsafe impl Send for PluginVtable {}
unsafe impl Sync for PluginVtable {}

// ── Plugin registry ────────────────────────────────────────────────────────

pub struct PluginRegistry {
    plugins: RwLock<HashMap<String, LoadedPlugin>>,
}

struct LoadedPlugin {
    info: PluginInfo,
    vtable: PluginVtable,
    /// Keep the shared library mapped in memory. Dropping this unloads the DLL.
    _lib: libloading::Library,
}

// SAFETY: LoadedPlugin wraps a loaded shared library and its resolved symbols.
// The `plugins` RwLock serializes all mutations. The shared library stays alive
// for the duration of the `LoadedPlugin` value. Send/Sync is safe because all
// access is serialized through the registry's lock, and the underlying library
// handles its own thread safety for C ABI calls.
unsafe impl Send for LoadedPlugin {}
unsafe impl Sync for LoadedPlugin {}

impl PluginRegistry {
    pub fn global() -> &'static Self {
        static REGISTRY: OnceLock<PluginRegistry> = OnceLock::new();
        REGISTRY.get_or_init(|| Self {
            plugins: RwLock::new(HashMap::new()),
        })
    }

    /// Load a plugin from a shared library file.
    ///
    /// Only `plugin_name` and `plugin_process` are required. All other symbols
    /// are optional — if absent the plugin will use sensible defaults.
    pub fn load(&self, path: &Path) -> Result<PluginInfo, String> {
        // SAFETY: `libloading::Library::new` opens the shared library at the
        // given path. The library stays loaded as long as the returned handle
        // is alive. We store it in `_lib` inside `LoadedPlugin` to guarantee
        // the function pointers remain valid.
        let lib = unsafe {
            libloading::Library::new(path)
                .map_err(|e| {
                    let msg = format!("Failed to load plugin {}: {e}", path.display());
                    log::error!("{msg}");
                    msg
                })?
        };

        // Required: plugin_name
        // SAFETY: `lib.get` returns a raw pointer to the symbol. We dereference
        // it to obtain a function pointer. The symbol is guaranteed to exist
        // because `get` returned `Ok`, and the library stays loaded via `_lib`.
        let name_fn: PluginNameFn = unsafe {
            *lib.get(b"plugin_name").map_err(|e| {
                let msg = format!("plugin_name not found: {e}");
                log::error!("{msg}");
                msg
            })?
        };

        // Required: plugin_process
        let process_fn: PluginProcessFn = unsafe {
            *lib.get(b"plugin_process").map_err(|e| {
                let msg = format!("plugin_process not found: {e}");
                log::error!("{msg}");
                msg
            })?
        };

        // Optional: plugin_version
        let version_fn: Option<PluginVersionFn> = unsafe {
            lib.get(b"plugin_version").ok().map(|sym| *sym)
        };

        // Optional: plugin_init
        let init_fn: Option<PluginInitFn> = unsafe {
            lib.get(b"plugin_init").ok().map(|sym| *sym)
        };

        // Optional: plugin_shutdown
        let shutdown_fn: Option<PluginShutdownFn> = unsafe {
            lib.get(b"plugin_shutdown").ok().map(|sym| *sym)
        };

        // Optional: plugin_config
        let config_fn: Option<PluginConfigFn> = unsafe {
            lib.get(b"plugin_config").ok().map(|sym| *sym)
        };

        // Read metadata — call the required name function
        // SAFETY: `name_fn` is a valid function pointer resolved from the
        // loaded library. It returns a pointer to a null-terminated C string
        // that is valid for the lifetime of the shared library.
        let name = unsafe { plugin_string(name_fn()) }
            .filter(|name| !name.trim().is_empty()).ok_or("Plugin returned an empty name")?;

        // Read version from optional symbol, or default
        let version = version_fn.and_then(|vf| {
            // SAFETY: Same reasoning as `name_fn` — valid pointer to C string
            // owned by the shared library.
            unsafe { plugin_string(vf()) }
        }).unwrap_or_else(|| "0.0.0".to_string());

        // Read plugin_config JSON from optional symbol
        let config = config_fn.map(|cf| {
            // SAFETY: `cf` returns a pointer to a JSON-encoded C string.
            // We parse it; if malformed we fall back to defaults.
            let json_str = unsafe { plugin_string(cf()) }.unwrap_or_default();
            serde_json::from_str::<PluginConfig>(&json_str).unwrap_or_default()
        }).unwrap_or_default();

        // Prevent replacing an initialized library without shutting it down.
        let mut plugins = self.plugins.write().map_err(|e| e.to_string())?;
        if plugins.contains_key(&name) { return Err(format!("Plugin '{name}' is already loaded")); }

        // Initialize (optional)
        if let Some(init) = init_fn {
            // SAFETY: `init` is a valid function pointer from the loaded library.
            let rc = init();
            if rc != 0 {
                let msg = format!("Plugin {name} init failed with code {rc}");
                log::error!("{msg}");
                return Err(msg);
            }
        }

        let info = PluginInfo {
            name: name.clone(),
            version: version.clone(),
            path: path.to_path_buf(),
            loaded: true,
            error: None,
            config,
        };

        let vtable = PluginVtable {
            name: name.clone(),
            version,
            init: init_fn,
            process: process_fn,
            shutdown: shutdown_fn,
            config_fn,
        };

        let loaded = LoadedPlugin {
            info: info.clone(),
            vtable,
            _lib: lib,
        };

        log::info!("Loaded plugin '{}' v{} from {}", info.name, info.version, info.path.display());
        plugins.insert(name.clone(), loaded);
        Ok(info)
    }

    /// Load all plugins from a directory. Errors for individual plugins are
    /// logged but do not prevent other plugins from loading.
    pub fn load_dir(&self, dir: &Path) -> Vec<PluginInfo> {
        let mut results = Vec::new();
        if !dir.is_dir() {
            log::warn!("Plugin directory does not exist: {}", dir.display());
            return results;
        }

        let ext = if cfg!(windows) {
            "dll"
        } else if cfg!(target_os = "macos") {
            "dylib"
        } else {
            "so"
        };

        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some(ext) {
                match self.load(&path) {
                    Ok(info) => results.push(info),
                    Err(e) => {
                        log::warn!("Skipping plugin {}: {e}", path.display());
                        results.push(PluginInfo {
                            name: path.file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("unknown")
                                .into(),
                            version: String::new(),
                            path,
                            loaded: false,
                            error: Some(e),
                            config: PluginConfig::default(),
                        });
                    }
                }
            }
        }
        results
    }

    /// Process a file through a named plugin.
    ///
    /// `options_json` is forwarded as-is to the plugin's C ABI `plugin_process`
    /// function, allowing arbitrary JSON configuration per-plugin.
    pub fn process(
        &self,
        plugin_name: &str,
        input: &str,
        output: &str,
        options_json: &str,
        progress_cb: Option<extern "C" fn(f32)>,
    ) -> Result<(), String> {
        // The C ABI does not require reentrant processing functions.
        let plugins = self.plugins.write().map_err(|e| e.to_string())?;
        let plugin = plugins
            .get(plugin_name)
            .ok_or_else(|| format!("Plugin '{plugin_name}' not loaded"))?;

        let c_input =
            CString::new(input).map_err(|e| format!("Invalid input path: {e}"))?;
        let c_output =
            CString::new(output).map_err(|e| format!("Invalid output path: {e}"))?;
        let c_options =
            CString::new(options_json).map_err(|e| format!("Invalid options JSON: {e}"))?;

        // SAFETY: All pointers are valid CStrings owned by this scope. The
        // function pointer `process` was resolved from a loaded library that
        // is kept alive by `_lib` in the `LoadedPlugin`. The progress callback
        // is optional and passed through as-is.
        let rc = (plugin.vtable.process)(
            c_input.as_ptr(),
            c_output.as_ptr(),
            c_options.as_ptr(),
            progress_cb,
        );

        if rc == 0 {
            Ok(())
        } else {
            let msg = format!("Plugin '{plugin_name}' process failed with code {rc}");
            log::error!("{msg}");
            Err(msg)
        }
    }

    /// Unload a plugin (calls its shutdown function if present).
    pub fn unload(&self, plugin_name: &str) -> Result<(), String> {
        let mut plugins = self.plugins.write().unwrap();
        let plugin = plugins
            .remove(plugin_name)
            .ok_or_else(|| format!("Plugin '{plugin_name}' not loaded"))?;

        if let Some(shutdown) = plugin.vtable.shutdown {
            // SAFETY: `shutdown` is a valid function pointer from the loaded
            // library, which is still alive because `plugin` has not been dropped.
            shutdown();
        }

        log::info!("Unloaded plugin '{plugin_name}'");
        Ok(())
    }

    /// List all loaded plugins.
    pub fn list(&self) -> Vec<PluginInfo> {
        self.plugins
            .read()
            .unwrap()
            .values()
            .map(|p| p.info.clone())
            .collect()
    }
}

// ── Tauri command bindings ─────────────────────────────────────────────────

use tauri::command;

#[command]
pub async fn plugin_list() -> Result<Vec<PluginInfo>, String> {
    Ok(PluginRegistry::global().list())
}

#[command]
pub async fn plugin_load(path: String) -> Result<PluginInfo, String> {
    tauri::async_runtime::spawn_blocking(move || PluginRegistry::global().load(Path::new(&path)))
        .await.map_err(|e| e.to_string())?
}

#[command]
pub async fn plugin_unload(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || PluginRegistry::global().unload(&name))
        .await.map_err(|e| e.to_string())?
}

#[command]
pub async fn plugin_process(
    name: String,
    input: String,
    output: String,
    options: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || PluginRegistry::global().process(&name, &input, &output, &options, None))
        .await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_plugin_metadata_does_not_dereference_null() {
        assert_eq!(unsafe { plugin_string(std::ptr::null()) }, None);
        let name = CString::new("Test plugin").unwrap();
        assert_eq!(unsafe { plugin_string(name.as_ptr()) }.as_deref(), Some("Test plugin"));
    }

    #[test]
    fn unloaded_plugin_reports_error() {
        let registry = PluginRegistry { plugins: RwLock::new(HashMap::new()) };
        assert!(registry.process("missing", "in", "out", "{}", None).unwrap_err().contains("not loaded"));
        assert!(registry.unload("missing").unwrap_err().contains("not loaded"));
    }
}
