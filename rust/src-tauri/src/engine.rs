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
    active: Mutex<Option<ActiveProcess>>,
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
    search_dirs.push(resource_dir.join("Engine/bin"));
    if let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(std::path::Path::to_path_buf)) {
        search_dirs.push(dir);
    }
    search_dirs.push(paths::project_root().join("Engine/bin"));
    search_dirs.push(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("bin"));
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
        // Truncate by bytes (safe since Python outputs UTF-8 with PYTHONIOENCODING=utf-8)
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

    // Read stdout and stderr concurrently to avoid blocking the tokio runtime
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

    // Parse response - break early once valid response is found (protocol guarantees first valid line)
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

pub async fn run_interactive_command(app: AppHandle, value: serde_json::Value, prefix: &str) -> Result<(), String> {
    let operation = app.state::<crate::operations::Operations>().begin()?;
    let state = app.state::<PythonEngine>();
    {
        let active = state.active.lock().await;
        if active.is_some() { return Err("An operation is already in progress".into()); }
    }
    let mut child = command(&app)?.spawn().map_err(|e| format!("Failed to start Python: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Missing engine stdin")?;
    let stdout = child.stdout.take().ok_or("Missing engine stdout")?;
    let stderr = child.stderr.take().ok_or("Missing engine stderr")?;
    send(&mut stdin, &value).await?;
    let pid = child.id();
    {
        let mut active = state.active.lock().await;
        *active = Some(ActiveProcess { child, stdin });
    }

    let errors = tokio::spawn(stderr_tail(stderr));
    let progress_event = format!("{prefix}-progress");
    let status_event = format!("{prefix}-status");
    let finished_event = format!("{prefix}-finished");
    let mut lines = BufReader::new(stdout).lines();
    let mut last_progress = None;
    let result = loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                match value.get("type").and_then(|v| v.as_str()) {
                    Some("progress") => if let Some(percent) = value.get("percent").and_then(|v| v.as_i64()) {
                        let percent = percent.clamp(0, 100);
                        if last_progress != Some(percent) {
                            let _ = app.emit(&progress_event, percent);
                            last_progress = Some(percent);
                        }
                    },
                    Some("download_status") => {
                        let status = serde_json::json!({
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
    {
        let mut active = state.active.lock().await;
        if active.as_ref().is_some_and(|process| process.child.id() == pid) {
            if let Some(process) = active.take() { reap(process).await; }
        }
    }
    let stderr = errors.await.unwrap_or_default();
    let result = result.unwrap_or_else(|message| FinishedEvent {
        ok: false, message: if stderr.is_empty() { message } else { format!("{message}\n{stderr}") }, file_path: String::new(),
    });
    let _ = app.emit(&finished_event, &result);
    drop(operation);
    if result.ok { Ok(()) } else { Err(result.message) }
}

#[tauri::command]
pub async fn cancel_operation(app: AppHandle) -> Result<(), String> {
    app.state::<crate::operations::Operations>().cancel();
    let state = app.state::<PythonEngine>();
    let mut active = state.active.lock().await;
    if let Some(mut process) = active.take() {
        let _ = send(&mut process.stdin, &serde_json::json!({ "cmd": "cancel" })).await;
        reap(process).await;
    }
    Ok(())
}
