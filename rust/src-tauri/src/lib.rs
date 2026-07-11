use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinishedEvent {
    pub ok: bool,
    pub message: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectFileResponse {
    pub ok: bool,
    pub file_type: String,
    pub allowed_formats: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlFormat {
    pub label: String,
    pub value: String,
    pub desc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectUrlResponse {
    pub ok: bool,
    pub title: String,
    pub duration: String,
    pub thumbnail: String,
    pub webpage_url: String,
    pub is_live: bool,
    pub formats: Vec<UrlFormat>,
    pub format_type: String,
}

pub struct PythonEngine {
    pub child: tokio::sync::Mutex<Option<Child>>,
}

impl PythonEngine {
    pub fn new() -> Self {
        Self {
            child: tokio::sync::Mutex::new(None),
        }
    }
}

fn get_engine_path() -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let engine_path = std::path::Path::new(manifest_dir)
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("python-engine")
        .join("engine.py");
    engine_path.to_string_lossy().to_string()
}

fn find_python() -> String {
    for name in &["python", "python3", "py"] {
        if std::process::Command::new(name)
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .is_ok()
        {
            return name.to_string();
        }
    }
    "python".to_string()
}

async fn run_interactive_command(
    app: AppHandle,
    cmd_json: serde_json::Value,
    event_prefix: &str,
) -> Result<(), String> {
    let engine_path = get_engine_path();
    let python = find_python();

    let mut child = Command::new(&python)
        .arg(&engine_path)
        .arg("--interactive")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", python, e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    {
        let state = app.state::<PythonEngine>();
        *state.child.lock().await = Some(child);
    }

    let mut stdin = stdin;
    let cmd_str = serde_json::to_string(&cmd_json).map_err(|e| e.to_string())?;
    stdin
        .write_all(cmd_str.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    let prefix = event_prefix.to_string();

    tauri::async_runtime::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                let event_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match event_type {
                    "progress" => {
                        if let Some(percent) = parsed.get("percent").and_then(|v| v.as_i64()) {
                            let _ = app_handle.emit(&format!("{}-progress", prefix), percent as i32);
                        }
                    }
                    "finished" => {
                        let ok = parsed.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                        let message = parsed.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let file_path = parsed.get("file_path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let _ = app_handle.emit(
                            &format!("{}-finished", prefix),
                            FinishedEvent { ok, message, file_path },
                        );
                        break;
                    }
                    _ => {}
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn detect_file(_app: AppHandle, path: String, dev_mode: bool) -> Result<DetectFileResponse, String> {
    let engine_path = get_engine_path();
    let python = find_python();

    let cmd_json = serde_json::json!({
        "cmd": "detect_file",
        "path": path,
        "dev_mode": dev_mode,
    });

    let mut child = Command::new(&python)
        .arg(&engine_path)
        .arg("--interactive")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", python, e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    let mut stdin = stdin;
    let cmd_str = serde_json::to_string(&cmd_json).map_err(|e| e.to_string())?;
    stdin.write_all(cmd_str.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    drop(stdin);

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if let Ok(parsed) = serde_json::from_str::<DetectFileResponse>(&line) {
            return Ok(parsed);
        }
    }

    Err("No response from engine".to_string())
}

#[tauri::command]
async fn detect_url(_app: AppHandle, url: String) -> Result<DetectUrlResponse, String> {
    let engine_path = get_engine_path();
    let python = find_python();

    let cmd_json = serde_json::json!({
        "cmd": "detect_url",
        "url": url,
    });

    let mut child = Command::new(&python)
        .arg(&engine_path)
        .arg("--interactive")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", python, e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    let mut stdin = stdin;
    let cmd_str = serde_json::to_string(&cmd_json).map_err(|e| e.to_string())?;
    stdin.write_all(cmd_str.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    drop(stdin);

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if let Ok(parsed) = serde_json::from_str::<DetectUrlResponse>(&line) {
            return Ok(parsed);
        }
    }

    Err("No response from engine".to_string())
}

#[tauri::command]
async fn start_convert(
    app: AppHandle,
    input: String,
    output: String,
    format: String,
    dev_mode: bool,
) -> Result<(), String> {
    let cmd_json = serde_json::json!({
        "cmd": "start_convert",
        "input": input,
        "output": output,
        "format": format,
        "dev_mode": dev_mode,
    });

    run_interactive_command(app, cmd_json, "convert").await
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    url: String,
    format_type: String,
    output_dir: String,
) -> Result<(), String> {
    let cmd_json = serde_json::json!({
        "cmd": "start_download",
        "url": url,
        "format_type": format_type,
        "output_dir": output_dir,
    });

    run_interactive_command(app, cmd_json, "download").await
}

#[tauri::command]
async fn cancel_operation(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PythonEngine>();
    let mut child_guard = state.child.lock().await;
    if let Some(ref mut child) = *child_guard {
        child.kill().await.map_err(|e| e.to_string())?;
    }
    *child_guard = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .manage(PythonEngine::new())
        .invoke_handler(tauri::generate_handler![
            detect_file,
            detect_url,
            start_convert,
            start_download,
            cancel_operation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
