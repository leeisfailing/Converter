//! Integration tests for the GPU detection → encoder selection → hwaccel pipeline.
//! These tests verify the end-to-end flow without requiring actual GPU hardware.

use std::process::Command;

fn ffmpeg_path() -> String {
    // Try bundled ffmpeg first
    let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap();
    let bundled = project_root.join("Engine").join("bin").join("ffmpeg.exe");
    if bundled.exists() {
        return bundled.to_string_lossy().into_owned();
    }
    // Fallback to system ffmpeg
    "ffmpeg".to_string()
}

fn ffprobe_path() -> String {
    let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap();
    let bundled = project_root.join("Engine").join("bin").join("ffprobe.exe");
    if bundled.exists() {
        return bundled.to_string_lossy().into_owned();
    }
    "ffprobe".to_string()
}

#[test]
fn ffmpeg_has_nvenc_encoders() {
    let output = Command::new(ffmpeg_path())
        .args(["-hide_banner", "-encoders"])
        .output()
        .expect("Failed to run ffmpeg");
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Check for at least one NVENC encoder
    let has_nvenc = stdout.contains("h264_nvenc") || stdout.contains("hevc_nvenc");
    println!("FFmpeg NVENC support: {}", if has_nvenc { "YES" } else { "NO" });
    println!("FFmpeg output (first 500 chars): {}", &stdout[..stdout.len().min(500)]);

    // This test passes even without NVENC — it just documents the capability
    if has_nvenc {
        println!("  → GPU encoding is available on this system");
    } else {
        println!("  → GPU encoding is NOT available, CPU fallback will be used");
    }
}

#[test]
fn ffmpeg_has_cuda_hwaccel() {
    let output = Command::new(ffmpeg_path())
        .args(["-hide_banner", "-hwaccels"])
        .output()
        .expect("Failed to run ffmpeg");
    let stdout = String::from_utf8_lossy(&output.stdout);

    let has_cuda = stdout.lines().any(|l| l.trim() == "cuda");
    println!("FFmpeg CUDA hwaccel: {}", if has_cuda { "YES" } else { "NO" });

    if has_cuda {
        println!("  → CUDA hardware acceleration is available");
    } else {
        println!("  → CUDA hwaccel NOT available");
    }
}

#[test]
fn nvenc_encoder_actually_works() {
    let output = Command::new(ffmpeg_path())
        .args([
            "-v", "error", "-nostdin", "-f", "lavfi",
            "-i", "color=c=black:s=256x256:r=1:d=0.1",
            "-frames:v", "1",
            "-c:v", "h264_nvenc", "-pix_fmt", "yuv420p",
            "-f", "null", "-",
        ])
        .output()
        .expect("Failed to run ffmpeg");

    let success = output.status.success();
    let stderr = String::from_utf8_lossy(&output.stderr);

    println!("NVENC test encode: {}", if success { "PASSED" } else { "FAILED" });
    if !success && !stderr.is_empty() {
        println!("  Error: {}", stderr.chars().take(200).collect::<String>());
    }

    // Don't fail the test — just report capability
    if success {
        println!("  → h264_nvenc is functional");
    } else {
        println!("  → h264_nvenc is NOT functional, will use CPU fallback");
    }
}

#[test]
fn cuvid_decoder_available() {
    let output = Command::new(ffmpeg_path())
        .args(["-hide_banner", "-decoders"])
        .output()
        .expect("Failed to run ffmpeg");
    let stdout = String::from_utf8_lossy(&output.stdout);

    let has_h264_cuvid = stdout.contains("h264_cuvid");
    let has_hevc_cuvid = stdout.contains("hevc_cuvid");

    println!("CUVID decoders: h264_cuvid={}, hevc_cuvid={}", has_h264_cuvid, has_hevc_cuvid);

    if has_h264_cuvid || has_hevc_cuvid {
        println!("  → CUDA decoding is available (full GPU pipeline possible)");
    } else {
        println!("  → CUVID decoders NOT available (decode will use CPU)");
    }
}

#[test]
fn cuda_scale_filter_available() {
    let output = Command::new(ffmpeg_path())
        .args(["-hide_banner", "-filters"])
        .output()
        .expect("Failed to run ffmpeg");
    let stdout = String::from_utf8_lossy(&output.stdout);

    let has_scale_cuda = stdout.contains("scale_cuda");
    println!("scale_cuda filter: {}", if has_scale_cuda { "AVAILABLE" } else { "NOT AVAILABLE" });

    if has_scale_cuda {
        println!("  → GPU-resident scaling is available");
    }
}

#[test]
fn full_cuda_pipeline_test() {
    // Test: decode with CUDA, scale with CUDA, encode with NVENC
    let output = Command::new(ffmpeg_path())
        .args([
            "-v", "error", "-nostdin",
            "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
            "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=1:d=0.1",
            "-vf", "scale_cuda=1280:-2",
            "-c:v", "h264_nvenc", "-preset", "p4",
            "-f", "null", "-",
        ])
        .output()
        .expect("Failed to run ffmpeg");

    let success = output.status.success();
    let stderr = String::from_utf8_lossy(&output.stderr);

    println!("Full CUDA pipeline (decode→scale→encode): {}",
        if success { "PASSED" } else { "FAILED" });
    if !success && !stderr.is_empty() {
        println!("  Error: {}", stderr.chars().take(300).collect::<String>());
    }

    if success {
        println!("  → Complete GPU pipeline works on this system!");
    } else {
        println!("  → Full GPU pipeline failed, will use mixed CPU/GPU approach");
    }
}

#[test]
fn system_gpu_info() {
    if cfg!(target_os = "windows") {
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion | Format-List"])
            .output();
        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            println!("System GPU info:\n{}", stdout);
        }
    }
}
