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
        if operation.is_cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "Operation cancelled"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x08000000);
        }
        let mut child = self.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn()?;
        let errors = capture_tail(child.stderr.take().expect("piped stderr"));

        let status = wait_for_child(&mut child, operation)?;
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

fn kill_tree(pid: u32) {
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
    #[cfg(not(windows))]
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
        let operation = state.begin().unwrap();
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
        let operation = state.begin().unwrap();
        state.cancel();
        let error = Command::new("this-command-must-not-run").output_cancellable(&operation).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    }
}
