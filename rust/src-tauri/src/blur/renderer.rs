use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc;

use super::presets;
use super::settings::BlurSettings;
use super::video_info::VideoInfo;

fn find_binary(exe_names: &[&str], check_arg: &str) -> String {
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) {
        for name in exe_names {
            let p = exe_dir.join(name);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
        for name in exe_names {
            let p = exe_dir.join("Engine").join("bin").join(name);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for name in exe_names {
            let p = cwd.join("Engine").join("bin").join(name);
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }
    for name in exe_names {
        if let Ok(mut child) = Command::new(name)
            .arg(check_arg)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            let _ = child.wait();
            return name.to_string();
        }
    }
    exe_names[0].to_string()
}

fn find_vspipe() -> String {
    find_binary(&["vspipe.exe", "vspipe"], "--version")
}

fn find_ffmpeg() -> String {
    find_binary(&["ffmpeg.exe", "ffmpeg"], "-version")
}

pub fn get_vapoursynth_script_path() -> Result<String, String> {
    // First try runtime path relative to the executable
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) {
        let script_path = exe_dir.join("vapoursynth").join("vapoursynth_render.py");
        if script_path.exists() {
            return Ok(script_path.to_string_lossy().to_string());
        }
        // Also check Engine directory for dev layout
        let script_path = exe_dir.parent().unwrap_or(&exe_dir).join("Engine").join("vapoursynth").join("vapoursynth_render.py");
        if script_path.exists() {
            return Ok(script_path.to_string_lossy().to_string());
        }
    }
    // Fallback to compile-time path (development)
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let script_path = std::path::Path::new(manifest_dir)
        .join("vapoursynth")
        .join("vapoursynth_render.py");

    if !script_path.exists() {
        return Err(format!(
            "VapourSynth script not found at: {}",
            script_path.display()
        ));
    }

    Ok(script_path.to_string_lossy().to_string())
}

pub struct RenderCommands {
    pub vspipe: Vec<String>,
    pub ffmpeg: Vec<String>,
}

pub fn build_render_commands(
    input_path: &str,
    output_path: &str,
    video_info: &VideoInfo,
    settings: &BlurSettings,
) -> Result<RenderCommands, String> {
    let blur_script = get_vapoursynth_script_path()?;
    let settings_json = settings.to_json_value();

    let input_path_normalized = input_path.replace('\\', "/");

    let mut vspipe_args = vec![
        "-p".to_string(),
        "-c".to_string(),
        "y4m".to_string(),
        "-a".to_string(),
        format!("video_path={}", input_path_normalized),
        "-a".to_string(),
        format!("fps_num={}", video_info.fps_num),
        "-a".to_string(),
        format!("fps_den={}", video_info.fps_den),
        "-a".to_string(),
        format!(
            "color_range={}",
            video_info.color_range.as_deref().unwrap_or("undefined")
        ),
        "-a".to_string(),
        format!("settings={}", settings_json),
    ];

    #[cfg(target_os = "windows")]
    {
        vspipe_args.push("-a".to_string());
        vspipe_args.push("enable_lsmash=true".to_string());
    }

    vspipe_args.push(blur_script);
    vspipe_args.push("-".to_string());

    let mut ffmpeg_args = vec![
        "-loglevel".to_string(),
        "error".to_string(),
        "-hide_banner".to_string(),
        "-stats".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        "-".to_string(),
        "-fflags".to_string(),
        "+genpts".to_string(),
        "-i".to_string(),
        input_path.to_string(),
        "-map".to_string(),
        "0:v".to_string(),
        "-map".to_string(),
        "1:a?".to_string(),
    ];

    // Color metadata preservation
    let mut setparams_parts = Vec::new();
    if let Some(ref range) = video_info.color_range {
        let r = if range == "pc" { "full" } else { "limited" };
        setparams_parts.push(format!("range={}", r));
    }
    if let Some(ref cs) = video_info.color_space {
        setparams_parts.push(format!("colorspace={}", cs));
    }
    if let Some(ref ct) = video_info.color_transfer {
        setparams_parts.push(format!("color_trc={}", ct));
    }
    if let Some(ref cp) = video_info.color_primaries {
        setparams_parts.push(format!("color_primaries={}", cp));
    }

    if !setparams_parts.is_empty() {
        ffmpeg_args.push("-vf".to_string());
        ffmpeg_args.push(format!("setparams={}", setparams_parts.join(":")));
    }

    if let Some(ref pix_fmt) = video_info.pix_fmt {
        ffmpeg_args.push("-pix_fmt".to_string());
        ffmpeg_args.push(pix_fmt.clone());
    }

    // Audio timescale filters
    let mut audio_filters = Vec::new();
    if settings.timescale {
        let sample_rate: i32 = video_info.sample_rate.unwrap_or(48000);
        if (settings.input_timescale - 1.0).abs() > f64::EPSILON {
            audio_filters.push(format!(
                "asetrate={}*{}",
                sample_rate,
                1.0 / settings.input_timescale
            ));
            audio_filters.push("aresample=48000".to_string());
        }
        if (settings.output_timescale - 1.0).abs() > f64::EPSILON {
            if settings.output_timescale_audio_pitch {
                audio_filters.push(format!(
                    "asetrate={}*{}",
                    sample_rate, settings.output_timescale
                ));
                audio_filters.push("aresample=48000".to_string());
            } else {
                audio_filters.push(format!("atempo={}", settings.output_timescale));
            }
        }
    }

    if !audio_filters.is_empty() {
        ffmpeg_args.push("-af".to_string());
        ffmpeg_args.push(audio_filters.join(","));
    }

    // Custom ffmpeg override or preset encoding
    if !settings.advanced.ffmpeg_override.is_empty() {
        let override_args: Vec<String> = settings
            .advanced
            .ffmpeg_override
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
        ffmpeg_args.extend(override_args);
    } else {
        let gpu_type = if settings.gpu_encoding {
            detect_gpu_type_for_preset()
        } else {
            "cpu"
        };

        let preset_name = if settings.encode_preset.is_empty() {
            "h264"
        } else {
            &settings.encode_preset
        };

        let preset_args = presets::find_preset_params(gpu_type, preset_name, settings.quality);
        ffmpeg_args.extend(preset_args);

        ffmpeg_args.extend(["-c:a".to_string(), "aac".to_string()]);
        ffmpeg_args.extend(["-b:a".to_string(), "320k".to_string()]);
        ffmpeg_args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    ffmpeg_args.push(output_path.to_string());

    Ok(RenderCommands {
        vspipe: vspipe_args,
        ffmpeg: ffmpeg_args,
    })
}

fn detect_gpu_type_for_preset() -> &'static str {
    let info = super::gpu::detect_gpu_type();
    match info.gpu_type.as_str() {
        "nvidia" => "nvidia",
        "amd" => "amd",
        "intel" => "intel",
        "mac" => "mac",
        _ => "cpu",
    }
}

pub fn run_render<F: FnMut(i32, i32)>(
    input_path: &str,
    output_path: &str,
    video_info: &VideoInfo,
    settings: &BlurSettings,
    mut progress_callback: F,
) -> Result<(), String> {
    let commands = build_render_commands(input_path, output_path, video_info, settings)?;

    let vspipe = find_vspipe();
    let ffmpeg = find_ffmpeg();

    // Set up plugin paths so vspipe can find bundled VS plugins
    let plugin_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| p.join("plugins"))
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|p| p.join("Engine").join("bin").join("plugins"))
        });

    let mut vspipe_cmd = Command::new(&vspipe);
    vspipe_cmd.args(&commands.vspipe);
    if let Some(ref pp) = plugin_path {
        if pp.exists() {
            let current = std::env::var("VAPOURSYNTH_EXTRA_PLUGIN_PATH").unwrap_or_default();
            let new_path = if current.is_empty() {
                pp.to_string_lossy().to_string()
            } else {
                format!("{};{}", current, pp.to_string_lossy())
            };
            vspipe_cmd.env("VAPOURSYNTH_EXTRA_PLUGIN_PATH", &new_path);
        }
    }

    let mut vspipe_child = vspipe_cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn vspipe: {}", e))?;

    let vspipe_stdout = match vspipe_child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = vspipe_child.kill();
            return Err("Failed to capture vspipe stdout".to_string());
        }
    };

    let mut ffmpeg_child = match Command::new(&ffmpeg)
        .args(&commands.ffmpeg)
        .stdin(vspipe_stdout)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = vspipe_child.kill();
            let _ = vspipe_child.wait();
            return Err(format!("Failed to spawn ffmpeg: {}", e));
        }
    };

    let ffmpeg_stderr = match ffmpeg_child.stderr.take() {
        Some(s) => s,
        None => {
            let _ = ffmpeg_child.kill();
            let _ = ffmpeg_child.wait();
            let _ = vspipe_child.kill();
            let _ = vspipe_child.wait();
            return Err("Failed to capture ffmpeg stderr".to_string());
        }
    };

    let (progress_tx, progress_rx) = mpsc::channel::<(i32, i32)>();

    // Read vspipe stderr for progress
    let vspipe_stderr = vspipe_child.stderr.take();
    let progress_handle = std::thread::spawn(move || {
        if let Some(stderr) = vspipe_stderr {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if line.starts_with("Frame:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let frame_info = parts[1];
                        if let Some((current, total)) = frame_info.split_once('/') {
                            if let (Ok(c), Ok(t)) = (current.parse::<i32>(), total.parse::<i32>()) {
                                if t > 0 {
                                    let _ = progress_tx.send((c, t));
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Read ffmpeg stderr for errors
    let ffmpeg_reader = BufReader::new(ffmpeg_stderr);
    let mut ffmpeg_errors = Vec::new();

    // Poll both processes and progress channel
    loop {
        // Drain progress updates
        while let Ok((current, total)) = progress_rx.try_recv() {
            progress_callback(current, total);
        }

        match ffmpeg_child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(e) => {
                let _ = ffmpeg_child.kill();
                let _ = ffmpeg_child.wait();
                let _ = vspipe_child.kill();
                let _ = vspipe_child.wait();
                let _ = progress_handle.join();
                return Err(format!("Error checking ffmpeg status: {}", e));
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    let _ = vspipe_child.kill();

    // Drain remaining progress updates
    while let Ok((current, total)) = progress_rx.try_recv() {
        progress_callback(current, total);
    }

    // Collect any remaining ffmpeg stderr lines
    for line in ffmpeg_reader.lines().map_while(Result::ok) {
        if !line.is_empty() {
            ffmpeg_errors.push(line);
        }
    }

    let vspipe_exit = match vspipe_child.wait() {
        Ok(s) => s,
        Err(e) => {
            return Err(format!("Failed to wait for vspipe: {}", e));
        }
    };
    let ffmpeg_exit = ffmpeg_child
        .wait()
        .map_err(|e| format!("Failed to wait for ffmpeg: {}", e))?;

    let _ = progress_handle.join();

    if !ffmpeg_exit.success() {
        let mut error_msg = String::new();
        if !ffmpeg_errors.is_empty() {
            error_msg.push_str(&ffmpeg_errors.join("\n"));
        }
        if error_msg.is_empty() {
            error_msg = format!(
                "vspipe exit: {}, ffmpeg exit: {}",
                vspipe_exit.code().unwrap_or(-1),
                ffmpeg_exit.code().unwrap_or(-1)
            );
        }
        return Err(error_msg);
    }

    progress_callback(100, 100);

    Ok(())
}
