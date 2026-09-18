//! JSON-lines bridge: own, drain and reap each Python process before releasing a job.
use crate::{models::FinishedEvent, paths};
use serde::de::DeserializeOwned;
use std::{collections::VecDeque, process::Stdio, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, Command}, sync::Mutex};

const ENGINE_TIMEOUT_SECS: u64 = 120;
const REAP_TIMEOUT_SECS: u64 = 10;
const MAX_STDERR_LINES: usize = 128;
const MAX_LINE_LENGTH: usize = 4096;

pub struct ActiveProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct PythonEngine {
    active: Mutex<std::collections::HashMap<String, ActiveProcess>>,
}

impl PythonEngine {
    /// Kill any running Python engine process immediately.
    /// Called on app shutdown to ensure all processes are terminated.
    pub async fn shutdown(&self) {
        let processes = std::mem::take(&mut *self.active.lock().await);
        for (_, mut process) in processes {
            log::info!("Killing active Python engine process");
            drop(process.stdin);
            let pid = process.child.id();
            // On Windows, use taskkill to kill the entire process tree
            #[cfg(windows)]
            if let Some(pid) = pid {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .await;
            }
            let _ = process.child.kill().await;
            let _ = process.child.wait().await;
            log::info!("Python engine process killed");
        }
    }
}

fn command(app: &AppHandle) -> Result<Command, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let (path, python) = paths::engine_runtime(&resource_dir, paths::project_root(), cfg!(debug_assertions));
    if !path.is_file() { return Err(format!("Python engine entry point not found: {}", path.display())); }
    let mut command = Command::new(&python);
    let mut search_dirs = Vec::with_capacity(16);
    if let Some(dir) = std::path::Path::new(&python).parent().filter(|dir| !dir.as_os_str().is_empty()) {
        search_dirs.push(dir.to_path_buf());
    }
    search_dirs.push(resource_dir.join("PyEngine/bin"));
    if let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(std::path::Path::to_path_buf)) {
        search_dirs.push(dir);
    }
    search_dirs.push(paths::project_root().join("PyEngine/bin"));
    search_dirs.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin"));
    if let Some(path) = std::env::var_os("PATH") { search_dirs.extend(std::env::split_paths(&path)); }
    command.env("PATH", std::env::join_paths(search_dirs).map_err(|e| e.to_string())?);
    command.args(["-u", "-B", "-X", "utf8"]).arg(path)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    Ok(command)
}

#[inline]
async fn send(stdin: &mut ChildStdin, value: &serde_json::Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    stdin.write_all(&bytes).await.map_err(|e| e.to_string())
}

async fn stderr_tail(stderr: tokio::process::ChildStderr) -> String {
    let mut lines = BufReader::new(stderr).lines();
    let mut tail = VecDeque::with_capacity(MAX_STDERR_LINES);
    while let Ok(Some(line)) = lines.next_line().await {
        if tail.len() == MAX_STDERR_LINES { tail.pop_front(); }
        let truncated = if line.len() > MAX_LINE_LENGTH {
            let end = line.floor_char_boundary(MAX_LINE_LENGTH);
            line[..end].to_string()
        } else {
            line
        };
        tail.push_back(truncated);
    }
    let mut result = String::with_capacity(tail.iter().map(|l| l.len() + 1).sum::<usize>());
    for (i, line) in tail.iter().enumerate() {
        if i > 0 { result.push('\n'); }
        result.push_str(line);
    }
    result
}

#[inline]
async fn reap(mut process: ActiveProcess) {
    drop(process.stdin);
    let timeout = Duration::from_secs(REAP_TIMEOUT_SECS);
    if tokio::time::timeout(timeout, process.child.wait()).await.is_err() {
        #[cfg(windows)]
        if let Some(pid) = process.child.id() {
            let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000).stdout(Stdio::null()).stderr(Stdio::null()).status().await;
        }
        let _ = process.child.kill().await;
        let _ = process.child.wait().await;
    }
}

pub async fn request<T: DeserializeOwned>(app: &AppHandle, value: serde_json::Value) -> Result<T, String> {
    let mut child = command(app)?.spawn().map_err(|e| format!("Failed to start Python: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Missing engine stdin")?;
    let stdout = child.stdout.take().ok_or("Missing engine stdout")?;
    let stderr = child.stderr.take().ok_or("Missing engine stderr")?;
    send(&mut stdin, &value).await?;
    drop(stdin);

    let mut stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut result = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            result.push(line);
        }
        result
    });
    let stderr_task = tokio::spawn(stderr_tail(stderr));

    let timeout = Duration::from_secs(ENGINE_TIMEOUT_SECS);
    let stdout_result = tokio::time::timeout(timeout, async {
        tokio::join!(&mut stdout_task, child.wait()).0
    }).await;

    let stdout_lines = match stdout_result {
        Ok(Ok(lines)) => lines,
        Ok(Err(e)) => return Err(format!("Engine output read error: {e}")),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!("Engine request timed out after {} seconds", ENGINE_TIMEOUT_SECS));
        },
    };

    for line in &stdout_lines {
        if line.is_empty() { continue; }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            if value.get("ok").and_then(|v| v.as_bool()) == Some(false) {
                let stderr = stderr_task.await.unwrap_or_default();
                let msg = value.get("error").and_then(|v| v.as_str()).unwrap_or("Engine request failed");
                return Err(if stderr.is_empty() { msg.to_string() } else { format!("{msg}\n{stderr}") });
            }
            if let Ok(response) = serde_json::from_value(value) { return Ok(response); }
        }
    }
    let stderr = stderr_task.await.unwrap_or_default();
    Err(format!("Engine returned no valid response: {stderr}"))
}

/// Run an interactive command via the Python engine.
/// `id` is a unique identifier echoed in all emitted events so the frontend
/// can route progress/finished to the correct queue item.
pub async fn run_interactive_command(app: AppHandle, value: serde_json::Value, prefix: &str, id: String) -> Result<(), String> {
    let ops = app.state::<crate::operations::Operations>();
    let op_type = match prefix {
        "download" => crate::operations::OpType::Download,
        "convert" => crate::operations::OpType::Convert,
        "transcoder" => crate::operations::OpType::Transcoder,
        "upscale" => crate::operations::OpType::Upscale,
        _ => crate::operations::OpType::Convert,
    };
    let operation = ops.begin(op_type, id.clone()).await.map_err(|e| e.to_string())?;
    let state = app.state::<PythonEngine>();
    let mut child = command(&app)?.spawn().map_err(|e| format!("Failed to start Python: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Missing engine stdin")?;
    let stdout = child.stdout.take().ok_or("Missing engine stdout")?;
    let stderr = child.stderr.take().ok_or("Missing engine stderr")?;
    send(&mut stdin, &value).await?;
    state.active.lock().await.insert(id.clone(), ActiveProcess { child, stdin });

    let errors = tokio::spawn(stderr_tail(stderr));
    let progress_event = format!("{prefix}-progress");
    let status_event = format!("{prefix}-status");
    let finished_event = format!("{prefix}-finished");
    let mut lines = BufReader::new(stdout).lines();
    let mut last_progress = None;
    let result = loop {
        if operation.is_cancelled() {
            break Err("Operation was cancelled".to_string());
        }
        match lines.next_line().await {
            Ok(Some(line)) => {
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                match value.get("type").and_then(|v| v.as_str()) {
                    Some("progress") => if let Some(percent) = value.get("percent").and_then(|v| v.as_i64()) {
                        let percent = percent.clamp(0, 100);
                        if last_progress != Some(percent) {
                            let _ = app.emit(&progress_event, serde_json::json!({ "id": &id, "percent": percent }));
                            last_progress = Some(percent);
                        }
                    },
                    Some("download_status") => {
                        let status = serde_json::json!({
                            "id": &id,
                            "percent": value.get("percent").and_then(|v| v.as_i64()).unwrap_or(0),
                            "speed": value.get("speed").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            "eta": value.get("eta").and_then(|v| v.as_i64()).unwrap_or(0),
                            "is_live": value.get("is_live").and_then(|v| v.as_bool()).unwrap_or(false),
                            "status": value.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                        });
                        let _ = app.emit(&status_event, status);
                    },
                    Some("finished") => break serde_json::from_value::<FinishedEvent>(value).map_err(|e| e.to_string()),
                    _ => if value.get("ok").and_then(|v| v.as_bool()) == Some(false) {
                        break Err(value.get("error").and_then(|v| v.as_str()).unwrap_or("Engine command failed").to_string());
                    },
                }
            }
            Ok(None) => break Err("Engine exited before completing the operation".into()),
            Err(error) => break Err(format!("Engine output read error: {error}")),
        }
    };
    let process = state.active.lock().await.remove(&id);
    if let Some(process) = process { reap(process).await; }
    ops.finish(&id);
    let stderr = errors.await.unwrap_or_default();
    let result = result.unwrap_or_else(|message| FinishedEvent {
        ok: false, message: if stderr.is_empty() { message } else { format!("{message}\n{stderr}") }, file_path: String::new(),
    });
    let finished = serde_json::json!({ "id": &id, "ok": result.ok, "message": result.message, "file_path": result.file_path });
    let _ = app.emit(&finished_event, finished);
    drop(operation);
    if result.ok { Ok(()) } else { Err(result.message) }
}

#[tauri::command]
pub async fn cancel_operation(app: AppHandle) -> Result<(), String> {
    app.state::<crate::operations::Operations>().cancel_all();
    let state = app.state::<PythonEngine>();
    let processes = std::mem::take(&mut *state.active.lock().await);
    for (_, mut process) in processes {
        let _ = send(&mut process.stdin, &serde_json::json!({ "cmd": "cancel" })).await;
        reap(process).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_operation_by_id(app: AppHandle, id: String) -> Result<(), String> {
    let ops = app.state::<crate::operations::Operations>();
    ops.cancel(&id);
    let state = app.state::<PythonEngine>();
    let process = state.active.lock().await.remove(&id);
    if let Some(mut process) = process {
        let _ = send(&mut process.stdin, &serde_json::json!({ "cmd": "cancel" })).await;
        reap(process).await;
    }
    Ok(())
}
