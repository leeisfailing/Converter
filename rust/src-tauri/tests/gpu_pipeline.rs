//! Bundled CUDA capability and real decode/scale/encode regression checks.
use std::{
    path::PathBuf,
    process::{Command, Output},
};

fn tool(name: &str) -> PathBuf {
    // Test the pinned Windows x64 sidecars assembled by bundle_runtime.py.
    // PyEngine/bin may contain different developer binaries and is absent in CI.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bin")
        .join(format!("{name}-x86_64-pc-windows-msvc.exe"));
    assert!(
        path.is_file(),
        "Bundled tool missing: {}. Run python scripts/bundle_runtime.py first.",
        path.display()
    );
    path
}

fn ffmpeg(args: &[&str]) -> Output {
    let mut command = Command::new(tool("ffmpeg"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .args(args)
        .output()
        .expect("Bundled ffmpeg is required")
}

#[test]
fn bundled_ffmpeg_includes_cuda_scaling() {
    let output = ffmpeg(&["-hide_banner", "-filters"]);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .any(|word| word == "scale_cuda"));
}

#[test]
fn real_cuda_decode_scale_encode() {
    let capability = ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=s=256x256:d=0.1",
        "-frames:v",
        "1",
        "-c:v",
        "h264_nvenc",
        "-f",
        "null",
        "-",
    ]);
    if !capability.status.success() {
        eprintln!("CUDA hardware regression skipped: no working NVIDIA encoder");
        return;
    }
    let folder = tempfile::tempdir().unwrap();
    let source = folder.path().join("source.mp4");
    let output = folder.path().join("scaled.mp4");
    let generated = ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x240:rate=10:duration=0.3",
        "-c:v",
        "libx264",
        source.to_str().unwrap(),
    ]);
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    let encoded = ffmpeg(&[
        "-v",
        "error",
        "-hwaccel",
        "cuda",
        "-hwaccel_output_format",
        "cuda",
        "-i",
        source.to_str().unwrap(),
        "-vf",
        "scale_cuda=w=640:h=480:interp_algo=lanczos",
        "-c:v",
        "h264_nvenc",
        output.to_str().unwrap(),
    ]);
    assert!(
        encoded.status.success(),
        "{}",
        String::from_utf8_lossy(&encoded.stderr)
    );
    let probe = Command::new(tool("ffprobe"))
        .args([
            "-v",
            "error",
            "-show_streams",
            "-of",
            "json",
            output.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(probe.status.success());
    let metadata: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(metadata["streams"][0]["width"], 640);
    assert_eq!(metadata["streams"][0]["height"], 480);
    assert_eq!(metadata["streams"][0]["nb_frames"], "3");
}
