use crate::operations::Operation;
use std::{io::{self, Read}, process::{Child, Command, Output, Stdio}, thread::{self, JoinHandle}};

const TAIL_LIMIT: usize = 64 * 1024;

pub fn capture_tail(mut reader: impl Read + Send + 'static) -> JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut tail = Vec::with_capacity(TAIL_LIMIT);
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    tail.extend_from_slice(&buffer[..count]);
                    if tail.len() > TAIL_LIMIT {
                        let excess = tail.len() - TAIL_LIMIT;
                        tail.drain(..excess);
                    }
                }
            }
        }
        tail
    })
}

pub trait CancellableCommand {
    fn output_cancellable(&mut self, operation: &Operation) -> io::Result<Output>;
}

impl CancellableCommand for Command {
    fn output_cancellable(&mut self, operation: &Operation) -> io::Result<Output> {
        while operation.is_paused() && !operation.is_cancelled() {
            thread::sleep(std::time::Duration::from_millis(25));
        }
        if operation.is_cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "Operation cancelled"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x08000000);
        }
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::process::CommandExt;
            self.process_group(0);
        }
        let mut child = self.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn()?;
        let registration = match operation.register_process(child.id()) {
            Ok(registration) => registration,
            Err(message) => {
                kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                return Err(io::Error::other(message));
            }
        };
        let errors = capture_tail(child.stderr.take().expect("piped stderr"));

        let status = match wait_for_child(&mut child, operation) {
            Ok(status) => status,
            Err(error) => {
                kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                drop(registration);
                let _ = errors.join();
                return Err(error);
            }
        };
        drop(registration);
        Ok(Output { status, stdout: Vec::new(), stderr: errors.join().unwrap_or_default() })
    }
}

fn wait_for_child(child: &mut Child, operation: &Operation) -> io::Result<std::process::ExitStatus> {
    let child_pid = child.id();

    loop {
        if operation.is_cancelled() {
            kill_tree(child_pid);
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(io::ErrorKind::Interrupted, "Operation cancelled"));
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => thread::sleep(std::time::Duration::from_millis(50)),
            Err(e) => return Err(e),
        }
    }
}

pub(crate) fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drains_large_output_but_keeps_only_bounded_tail() {
        let mut bytes = vec![b'a'; TAIL_LIMIT * 8];
        bytes.extend_from_slice(b"final error");
        let result = capture_tail(io::Cursor::new(bytes)).join().unwrap();
        assert_eq!(result.len(), TAIL_LIMIT);
        assert!(result.ends_with(b"final error"));
    }

    #[test]
    fn a_full_stderr_pipe_does_not_stall_the_child() {
        let state = crate::operations::Operations::default();
        let operation = tokio_test::block_on(state.begin(crate::operations::OpType::Convert, "test-stderr".into())).unwrap();
        let output = Command::new(crate::paths::python())
            .args(["-c", "import sys; sys.stderr.write('x' * 262144 + 'done')"])
            .output_cancellable(&operation).unwrap();
        assert!(output.status.success());
        assert_eq!(output.stderr.len(), TAIL_LIMIT);
        assert!(output.stderr.ends_with(b"done"));
    }

    #[test]
    fn cancellation_prevents_spawning_another_process() {
        let state = crate::operations::Operations::default();
        let operation = tokio_test::block_on(state.begin(crate::operations::OpType::Convert, "test-cancel".into())).unwrap();
        operation.cancelled_flag().store(true, std::sync::atomic::Ordering::Release);
        let error = Command::new("this-command-must-not-run").output_cancellable(&operation).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    }

    #[cfg(any(windows, target_os = "linux"))]
    #[test]
    fn queue_pause_stops_parent_and_descendant_and_cancel_still_reaps() {
        let folder = tempfile::tempdir().unwrap();
        let parent_file = folder.path().join("parent.txt");
        let descendant_file = folder.path().join("descendant.txt");
        let state = std::sync::Arc::new(crate::operations::Operations::default());
        let operation = std::sync::Arc::new(tokio_test::block_on(state.begin(
            crate::operations::OpType::Convert, "pause-tree".into())).unwrap());
        let running = operation.clone();
        let parent = parent_file.clone();
        let descendant = descendant_file.clone();
        let worker = thread::spawn(move || {
            Command::new(crate::paths::python()).args([
                "-X", "utf8", "-c",
                "import subprocess,sys,time,pathlib; code=\"import pathlib,sys,time; p=pathlib.Path(sys.argv[1]); [(p.write_text(str(i)),time.sleep(.02)) for i in range(10000)]\"; subprocess.Popen([sys.executable,'-c',code,sys.argv[2]]); p=pathlib.Path(sys.argv[1]); [(p.write_text(str(i)),time.sleep(.02)) for i in range(10000)]",
            ]).arg(parent).arg(descendant).output_cancellable(&running)
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !parent_file.exists() || !descendant_file.exists() {
            assert!(std::time::Instant::now() < deadline, "heartbeat children did not start");
            thread::sleep(std::time::Duration::from_millis(20));
        }
        state.set_paused(true).unwrap();
        thread::sleep(std::time::Duration::from_millis(100));
        let before = (std::fs::read(&parent_file).unwrap(), std::fs::read(&descendant_file).unwrap());
        thread::sleep(std::time::Duration::from_millis(250));
        assert_eq!(before, (std::fs::read(&parent_file).unwrap(), std::fs::read(&descendant_file).unwrap()), "paused process tree kept working");
        state.set_paused(false).unwrap();
        thread::sleep(std::time::Duration::from_millis(150));
        assert_ne!(before.0, std::fs::read(&parent_file).unwrap(), "parent did not resume");
        assert_ne!(before.1, std::fs::read(&descendant_file).unwrap(), "descendant did not resume");
        state.set_paused(true).unwrap();
        assert!(state.cancel("pause-tree"));
        assert_eq!(worker.join().unwrap().unwrap_err().kind(), io::ErrorKind::Interrupted);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_cancellation_terminates_descendant_processes() {
        let folder = tempfile::tempdir().unwrap();
        let child_pid_file = folder.path().join("child.pid");
        let state = crate::operations::Operations::default();
        let operation = std::sync::Arc::new(tokio_test::block_on(state.begin(
            crate::operations::OpType::Convert, "test-linux-process-tree".into())).unwrap());
        let running = operation.clone();
        let pid_file = child_pid_file.clone();
        let worker = thread::spawn(move || {
            Command::new(crate::paths::python()).args([
                "-c",
                "import pathlib, subprocess, sys, time; child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)']); pathlib.Path(sys.argv[1]).write_text(str(child.pid)); time.sleep(30)",
            ]).arg(pid_file).output_cancellable(&running)
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !child_pid_file.is_file() {
            assert!(std::time::Instant::now() < deadline, "Child did not start");
            thread::sleep(std::time::Duration::from_millis(10));
        }
        let pid = std::fs::read_to_string(&child_pid_file).unwrap();
        operation.cancelled_flag().store(true, std::sync::atomic::Ordering::Release);
        assert_eq!(worker.join().unwrap().unwrap_err().kind(), io::ErrorKind::Interrupted);
        // A killed child can briefly be a zombie until the system reaps it.
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        assert!(stat.is_empty() || stat.split_once(") ").unwrap().1.starts_with('Z'),
                "Descendant was left running: {stat}");
    }
}
