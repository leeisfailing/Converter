//! System hardware detection and adaptive concurrency calculation.
//!
//! Detects CPU cores, RAM, and GPU capabilities to compute optimal
//! per-operation concurrency limits. Falls back to safe defaults on
//! detection failure.
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

// ── Public types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcurrencyInfo {
    pub download: usize,
    pub convert: usize,
    pub transcoder: usize,
    pub upscale: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleCapability {
    pub can_upscale: bool,
    pub target: String,
    pub required_ram_gb: f64,
    pub available_ram_gb: f64,
    pub message: String,
}

#[derive(Debug, Clone)]
struct SystemSpecs {
    logical_cores: usize,
    total_ram_gb: f64,
    gpu_count: usize,
    has_gpu: bool,
}

// ── Detection ──────────────────────────────────────────────────────────────

fn detect_specs() -> SystemSpecs {
    let logical_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    let total_ram_gb = detect_ram_gb();

    let gpu_info = detect_gpu_count();

    SystemSpecs {
        logical_cores,
        total_ram_gb,
        gpu_count: gpu_info.0,
        has_gpu: gpu_info.1,
    }
}

/// Detect total system RAM in GB.
fn detect_ram_gb() -> f64 {
    #[cfg(target_os = "windows")]
    {
        detect_ram_windows()
    }
    #[cfg(target_os = "linux")]
    {
        detect_ram_linux()
    }
    #[cfg(target_os = "macos")]
    {
        detect_ram_macos()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        8.0 // Safe fallback
    }
}

#[cfg(target_os = "windows")]
fn detect_ram_windows() -> f64 {
    use std::mem;
    #[repr(C)]
    #[allow(non_camel_case_types)]
    struct MEMORYSTATUSEX {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }
    type BOOL = i32;
    extern "system" {
        fn GlobalMemoryStatusEx(lpBuffer: *mut MEMORYSTATUSEX) -> BOOL;
    }
    unsafe {
        let mut mem: MEMORYSTATUSEX = mem::zeroed();
        mem.dw_length = mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut mem) != 0 {
            return mem.ull_total_phys as f64 / (1024.0 * 1024.0 * 1024.0);
        }
    }
    8.0
}

#[cfg(target_os = "linux")]
fn detect_ram_linux() -> f64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("MemTotal:"))
                .and_then(|l| {
                    l.split_whitespace()
                        .nth(1)
                        .and_then(|v| v.parse::<f64>().ok())
                        .map(|kb| kb / 1024.0 / 1024.0)
                })
        })
        .unwrap_or(8.0)
}

#[cfg(target_os = "macos")]
fn detect_ram_macos() -> f64 {
    std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8(o.stdout)
                .ok()
                .and_then(|s| s.trim().parse::<u64>().ok())
                .map(|bytes| bytes as f64 / (1024.0 * 1024.0 * 1024.0))
        })
        .unwrap_or(8.0)
}

/// Detect GPU count and whether any GPU is available.
/// Returns (count, has_gpu).
fn detect_gpu_count() -> (usize, bool) {
    // Use ffmpeg -encoders to check for GPU encoder availability.
    // Each working hardware encoder family counts as one GPU unit.
    let output = std::process::Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output();
    let text = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return (0, false),
    };
    let gpu_families = &[
        ("h264_nvenc", "NVIDIA"),
        ("hevc_nvenc", "NVIDIA"),
        ("av1_nvenc", "NVIDIA"),
        ("h264_amf", "AMD"),
        ("hevc_amf", "AMD"),
        ("av1_amf", "AMD"),
        ("h264_qsv", "Intel"),
        ("hevc_qsv", "Intel"),
        ("av1_qsv", "Intel"),
    ];
    let mut vendors_found = std::collections::HashSet::new();
    for &(enc, vendor) in gpu_families {
        if text.contains(enc) {
            vendors_found.insert(vendor);
        }
    }
    let count = vendors_found.len();
    (count, count > 0)
}

// ── Concurrency calculation ────────────────────────────────────────────────

/// Cached system specs (detected once per app lifetime).
fn cached_specs() -> &'static SystemSpecs {
    static SPECS: OnceLock<SystemSpecs> = OnceLock::new();
    SPECS.get_or_init(detect_specs)
}

/// Compute per-operation concurrency limits based on system specs.
pub fn compute_concurrency() -> ConcurrencyInfo {
    let specs = cached_specs();
    compute_concurrency_from(specs)
}

fn compute_concurrency_from(specs: &SystemSpecs) -> ConcurrencyInfo {
    let cores = specs.logical_cores;
    let ram = specs.total_ram_gb;
    let gpu_count = specs.gpu_count;

    // Downloads: network-bound, can handle more concurrent tasks.
    // Scale with cores but cap at 8. Low-RAM systems get fewer.
    let download = if ram < 4.0 {
        2
    } else if ram < 8.0 {
        (cores / 2).clamp(2, 4)
    } else {
        (cores / 2).clamp(2, 8)
    };

    // Conversions: CPU/GPU-bound. With GPU, can parallelize more.
    let convert = if gpu_count > 0 {
        // GPU offloads encoding; we can run more concurrent conversions.
        (gpu_count * 2).clamp(2, 4)
    } else if cores >= 8 {
        2
    } else if cores >= 4 {
        2
    } else {
        1
    };

    // Transcoding: same resource profile as conversion.
    let transcoder = convert;

    // Upscaling: very GPU/VRAM intensive. Each upscale session uses significant VRAM.
    let upscale = if gpu_count > 0 {
        // Each GPU can typically handle 1-2 upscale sessions.
        gpu_count.clamp(1, 2)
    } else {
        // CPU upscaling is extremely slow; only one at a time.
        1
    };

    // Apply RAM-based throttling: if RAM is very low, reduce everything.
    let (download, convert, transcoder, upscale) = if ram < 4.0 {
        (download.min(2), 1, 1, 1)
    } else if ram < 8.0 {
        (download.min(4), convert.min(2), transcoder.min(2), upscale)
    } else {
        (download, convert, transcoder, upscale)
    };

    ConcurrencyInfo { download, convert, transcoder, upscale }
}

/// Get a human-readable description of detected specs.
pub fn system_summary() -> String {
    let specs = cached_specs();
    let conc = compute_concurrency_from(specs);
    format!(
        "CPU: {} cores | RAM: {:.1} GB | GPU: {} | Concurrent — Download: {}, Convert: {}, Transcode: {}, Upscale: {}",
        specs.logical_cores,
        specs.total_ram_gb,
        if specs.has_gpu { format!("{} vendor(s)", specs.gpu_count) } else { "None".into() },
        conc.download,
        conc.convert,
        conc.transcoder,
        conc.upscale,
    )
}

// ── Upscale capability check ──────────────────────────────────────────────

/// Estimated RAM requirements per upscale target (in GB).
/// These are conservative estimates based on FFmpeg's frame buffer needs.
fn upscale_ram_requirement(target: &str) -> f64 {
    match target {
        "2k" => 2.0,   // 2560×1440 = 3.7M pixels × ~0.5 bytes/pixel ≈ 2GB with overhead
        "4k" => 4.0,   // 3840×2160 = 8.3M pixels
        "8k" => 16.0,  // 7680×4320 = 33.2M pixels
        "16k" => 64.0, // 15360×8640 = 132.7M pixels
        _ => 8.0,
    }
}

/// Check if the system can handle upscaling to the given target.
pub fn check_upscale_capability(target: &str) -> UpscaleCapability {
    let specs = cached_specs();
    let required = upscale_ram_requirement(target);
    let available = specs.total_ram_gb;

    // Reserve 2GB for OS and app
    let usable = available - 2.0;

    let (can_upscale, message) = if usable >= required {
        (true, format!(
            "System has {:.1}GB RAM, {:.1}GB required for {} upscaling. Sufficient resources.",
            usable, required, target.to_uppercase()
        ))
    } else if usable >= required * 0.5 {
        // Marginal: warn but allow
        (true, format!(
            "Warning: System has {:.1}GB RAM but {:.1}GB recommended for {} upscaling. Process may be slow or fail on long videos.",
            usable, required, target.to_uppercase()
        ))
    } else {
        (false, format!(
            "Insufficient RAM for {} upscaling. Required: {:.1}GB, Available: {:.1}GB. Use 8K or lower.",
            target.to_uppercase(), required, usable
        ))
    };

    UpscaleCapability {
        can_upscale,
        target: target.to_string(),
        required_ram_gb: required,
        available_ram_gb: usable,
        message,
    }
}

// ── Tauri command ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_system_summary() -> Result<String, String> {
    Ok(system_summary())
}

#[tauri::command]
pub async fn check_upscale(target: String) -> Result<UpscaleCapability, String> {
    if !matches!(target.as_str(), "2k" | "4k" | "8k" | "16k") {
        return Err("target must be one of: 2k, 4k, 8k, 16k".to_string());
    }
    Ok(check_upscale_capability(&target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrency_scales_with_cores() {
        let small = SystemSpecs { logical_cores: 2, total_ram_gb: 4.0, gpu_count: 0, has_gpu: false };
        let medium = SystemSpecs { logical_cores: 8, total_ram_gb: 16.0, gpu_count: 0, has_gpu: false };
        let large = SystemSpecs { logical_cores: 16, total_ram_gb: 32.0, gpu_count: 0, has_gpu: false };

        let c_small = compute_concurrency_from(&small);
        let c_medium = compute_concurrency_from(&medium);
        let c_large = compute_concurrency_from(&large);

        assert!(c_small.download <= c_medium.download);
        assert!(c_medium.download <= c_large.download);
    }

    #[test]
    fn gpu_increases_concurrency() {
        let no_gpu = SystemSpecs { logical_cores: 8, total_ram_gb: 16.0, gpu_count: 0, has_gpu: false };
        let one_gpu = SystemSpecs { logical_cores: 8, total_ram_gb: 16.0, gpu_count: 1, has_gpu: true };
        let two_gpu = SystemSpecs { logical_cores: 8, total_ram_gb: 16.0, gpu_count: 2, has_gpu: true };

        let c_no = compute_concurrency_from(&no_gpu);
        let c_one = compute_concurrency_from(&one_gpu);
        let c_two = compute_concurrency_from(&two_gpu);

        assert!(c_no.convert <= c_one.convert);
        assert!(c_one.convert <= c_two.convert);
        assert!(c_no.upscale <= c_one.upscale);
        assert!(c_one.upscale <= c_two.upscale);
    }

    #[test]
    fn low_ram_throttles_everything() {
        let low_ram = SystemSpecs { logical_cores: 16, total_ram_gb: 2.0, gpu_count: 2, has_gpu: true };
        let c = compute_concurrency_from(&low_ram);
        assert!(c.download <= 2);
        assert_eq!(c.convert, 1);
        assert_eq!(c.transcoder, 1);
        assert_eq!(c.upscale, 1);
    }

    #[test]
    fn defaults_are_at_least_one() {
        let specs = SystemSpecs { logical_cores: 1, total_ram_gb: 1.0, gpu_count: 0, has_gpu: false };
        let c = compute_concurrency_from(&specs);
        assert!(c.download >= 1);
        assert!(c.convert >= 1);
        assert!(c.transcoder >= 1);
        assert!(c.upscale >= 1);
    }
}
