//! Suspend only application-owned media process trees; retain OS ownership until resume.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub struct PauseRegistry {
    state: Mutex<State>,
}
#[derive(Default)]
struct State {
    paused: bool,
    processes: HashMap<u32, Entry>,
}
struct Entry {
    operation: String,
    suspension: Option<Suspension>,
}
pub struct ProcessRegistration {
    registry: Arc<PauseRegistry>,
    pid: u32,
}
impl Drop for ProcessRegistration {
    fn drop(&mut self) {
        if let Ok(mut state) = self.registry.state.lock() {
            // Resume before cleanup/reaping: no stopped child survives an abandoned job.
            state.processes.remove(&self.pid);
        }
    }
}
impl PauseRegistry {
    pub fn is_paused(&self) -> bool {
        self.state.lock().map(|state| state.paused).unwrap_or(true)
    }
    pub fn register(
        self: &Arc<Self>,
        operation: &str,
        pid: u32,
    ) -> Result<ProcessRegistration, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Process pause lock poisoned")?;
        if state.processes.contains_key(&pid) {
            return Err("Media process is already registered".into());
        }
        let suspension = if state.paused {
            Some(Suspension::new(pid)?)
        } else {
            None
        };
        state.processes.insert(
            pid,
            Entry {
                operation: operation.into(),
                suspension,
            },
        );
        Ok(ProcessRegistration {
            registry: self.clone(),
            pid,
        })
    }
    pub fn resume_operation(&self, operation: &str) {
        if let Ok(mut state) = self.state.lock() {
            for entry in state
                .processes
                .values_mut()
                .filter(|entry| entry.operation == operation)
            {
                entry.suspension.take();
            }
        }
    }
    pub fn set_paused(&self, paused: bool) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Process pause lock poisoned")?;
        if state.paused == paused {
            return Ok(());
        }
        if paused {
            for (&pid, entry) in state.processes.iter_mut() {
                match Suspension::new(pid) {
                    Ok(suspension) => entry.suspension = Some(suspension),
                    Err(error) => {
                        for entry in state.processes.values_mut() {
                            entry.suspension.take();
                        }
                        return Err(format!(
                            "Could not pause queue; running jobs resumed: {error}"
                        ));
                    }
                }
            }
        } else {
            let mut error = None;
            for entry in state.processes.values_mut() {
                if let Some(suspension) = entry.suspension.as_mut() {
                    if let Err(message) = suspension.resume() {
                        error = Some(message);
                    }
                }
            }
            if let Some(error) = error {
                // Return to the previous state if any resume failed.
                for (&pid, entry) in state.processes.iter_mut() {
                    entry.suspension.take();
                    entry.suspension = Some(Suspension::new(pid)?);
                }
                return Err(format!("Could not resume queue: {error}"));
            }
            for entry in state.processes.values_mut() {
                entry.suspension.take();
            }
        }
        state.paused = paused;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
struct Suspension {
    pid: u32,
    stopped: bool,
}
#[cfg(target_os = "linux")]
impl Suspension {
    fn new(pid: u32) -> Result<Self, String> {
        signal_group(pid, 19)?; // Linux SIGSTOP: includes FFmpeg descendants in this group.
        Ok(Self { pid, stopped: true })
    }
    fn resume(&mut self) -> Result<(), String> {
        if self.stopped {
            signal_group(self.pid, 18)?;
            self.stopped = false;
        }
        Ok(())
    }
}
#[cfg(target_os = "linux")]
fn signal_group(pid: u32, signal: i32) -> Result<(), String> {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    let pid = i32::try_from(pid).map_err(|_| "Invalid owned media process ID")?;
    if pid <= 0 {
        return Err("Invalid owned media process ID".into());
    }
    // SAFETY: only PIDs from our spawned child registry reach this function.
    if unsafe { kill(-pid, signal) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(3) {
        return Ok(());
    } // Already exited.
    Err(format!("Media process group signal failed: {error}"))
}

#[cfg(windows)]
use windows::Suspension;
#[cfg(windows)]
mod windows {
    use std::{collections::HashSet, ffi::c_void, mem::size_of};
    type Handle = *mut c_void;
    #[repr(C)]
    struct ProcessEntry {
        size: u32,
        usage: u32,
        pid: u32,
        heap: usize,
        module: u32,
        threads: u32,
        parent: u32,
        priority: i32,
        flags: u32,
        executable: [u16; 260],
    }
    #[repr(C)]
    struct ThreadEntry {
        size: u32,
        usage: u32,
        tid: u32,
        owner: u32,
        priority: i32,
        delta: i32,
        flags: u32,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
        fn Thread32First(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn Thread32Next(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn OpenThread(access: u32, inherit: i32, tid: u32) -> Handle;
        fn GetProcessIdOfThread(thread: Handle) -> u32;
        fn SuspendThread(thread: Handle) -> u32;
        fn ResumeThread(thread: Handle) -> u32;
        fn GetExitCodeThread(thread: Handle, code: *mut u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    struct OwnedHandle(usize);
    impl OwnedHandle {
        fn raw(&self) -> Handle {
            self.0 as Handle
        }
    }
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.raw());
            }
        }
    }
    fn snapshot(flags: u32) -> Result<OwnedHandle, String> {
        let handle = unsafe { CreateToolhelp32Snapshot(flags, 0) };
        if handle as isize == -1 {
            return Err(format!(
                "Cannot enumerate media threads: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(OwnedHandle(handle as usize))
    }
    pub(super) struct Suspension {
        handles: Vec<OwnedHandle>,
        tids: HashSet<u32>,
        pid: u32,
    }
    impl Suspension {
        pub(super) fn new(pid: u32) -> Result<Self, String> {
            let mut result = Self {
                handles: Vec::new(),
                tids: HashSet::new(),
                pid,
            };
            // Freeze parent threads first, then discover/freeze descendants. Repeat
            // until no thread can create another child while we take snapshots.
            for _ in 0..32 {
                let mut owners = HashSet::from([pid]);
                let processes = snapshot(2)?;
                let mut entry: ProcessEntry = unsafe { std::mem::zeroed() };
                entry.size = size_of::<ProcessEntry>() as u32;
                let mut relationships = Vec::new();
                if unsafe { Process32FirstW(processes.raw(), &mut entry) } != 0 {
                    loop {
                        relationships.push((entry.pid, entry.parent));
                        if unsafe { Process32NextW(processes.raw(), &mut entry) } == 0 {
                            break;
                        }
                    }
                }
                loop {
                    let before = owners.len();
                    for &(child, parent) in &relationships {
                        if owners.contains(&parent) {
                            owners.insert(child);
                        }
                    }
                    if owners.len() == before {
                        break;
                    }
                }
                let threads = snapshot(4)?;
                let mut thread: ThreadEntry = unsafe { std::mem::zeroed() };
                thread.size = size_of::<ThreadEntry>() as u32;
                let mut found = Vec::new();
                if unsafe { Thread32First(threads.raw(), &mut thread) } != 0 {
                    loop {
                        if owners.contains(&thread.owner) && !result.tids.contains(&thread.tid) {
                            found.push((thread.owner, thread.tid));
                        }
                        if unsafe { Thread32Next(threads.raw(), &mut thread) } == 0 {
                            break;
                        }
                    }
                }
                found.sort_by_key(|(owner, _)| *owner != pid);
                if found.is_empty() {
                    return Ok(result);
                }
                for (owner, tid) in found {
                    let handle = unsafe { OpenThread(0x0002 | 0x0040, 0, tid) }; // SUSPEND_RESUME + QUERY_INFORMATION
                    if handle.is_null() {
                        if std::io::Error::last_os_error().raw_os_error() == Some(87) {
                            continue;
                        } // Exited.
                        return Err(format!(
                            "Cannot open media thread: {}",
                            std::io::Error::last_os_error()
                        ));
                    }
                    let owned = OwnedHandle(handle as usize);
                    // A thread ID can be recycled after the snapshot. Verify
                    // its immutable owner through the opened handle before
                    // suspending it, so an unrelated process is never frozen.
                    let actual_owner = unsafe { GetProcessIdOfThread(handle) };
                    if actual_owner == 0 {
                        return Err(format!(
                            "Cannot verify media thread owner: {}",
                            std::io::Error::last_os_error()
                        ));
                    }
                    if actual_owner != owner {
                        continue;
                    }
                    if unsafe { SuspendThread(handle) } == u32::MAX {
                        let mut code = 0;
                        if unsafe { GetExitCodeThread(handle, &mut code) } != 0 && code != 259 {
                            continue;
                        }
                        return Err(format!(
                            "Cannot suspend media thread: {}",
                            std::io::Error::last_os_error()
                        ));
                    }
                    result.tids.insert(tid);
                    result.handles.push(owned);
                }
            }
            Err("Media process tree kept changing while pausing".into())
        }
        pub(super) fn resume(&mut self) -> Result<(), String> {
            let mut failed = Vec::new();
            for handle in self.handles.drain(..) {
                if unsafe { ResumeThread(handle.raw()) } == u32::MAX {
                    let mut code = 0;
                    if unsafe { GetExitCodeThread(handle.raw(), &mut code) } == 0 || code == 259 {
                        failed.push(handle);
                    }
                }
            }
            self.handles = failed;
            if self.handles.is_empty() {
                self.tids.clear();
                Ok(())
            } else {
                Err("Cannot resume media threads".into())
            }
        }
    }
    impl Drop for Suspension {
        fn drop(&mut self) {
            if self.resume().is_err() {
                crate::process_output::kill_tree(self.pid);
            }
        }
    }
}
#[cfg(target_os = "linux")]
impl Drop for Suspension {
    fn drop(&mut self) {
        if let Err(error) = self.resume() {
            log::error!("{error}");
            crate::process_output::kill_tree(self.pid);
        }
    }
}
#[cfg(not(any(windows, target_os = "linux")))]
struct Suspension;
#[cfg(not(any(windows, target_os = "linux")))]
impl Suspension {
    fn new(_: u32) -> Result<Self, String> {
        Err("Queue suspension is supported on Linux and Windows".into())
    }
    fn resume(&mut self) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;

    #[test]
    fn registering_while_paused_stops_child_and_drop_resumes_it() {
        let registry = Arc::new(PauseRegistry::default());
        registry.set_paused(true).unwrap();
        let mut child = std::process::Command::new(crate::paths::python())
            .args(["-c", "import time; time.sleep(30)"])
            .process_group(0)
            .spawn()
            .unwrap();
        let registration = registry.register("late-child", child.id()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let stat = std::fs::read_to_string(format!("/proc/{}/stat", child.id())).unwrap();
        assert!(
            stat.split_once(") ").unwrap().1.starts_with('T'),
            "new child was not stopped: {stat}"
        );
        drop(registration);
        std::thread::sleep(std::time::Duration::from_millis(50));
        let stat = std::fs::read_to_string(format!("/proc/{}/stat", child.id())).unwrap();
        assert!(
            !stat.split_once(") ").unwrap().1.starts_with('T'),
            "registration drop left child stopped"
        );
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn failed_pause_rolls_back_and_leaves_admission_running() {
        let registry = Arc::new(PauseRegistry::default());
        let registration = registry.register("invalid-test-process", u32::MAX).unwrap();
        assert!(registry.set_paused(true).is_err());
        assert!(!registry.is_paused());
        drop(registration);
    }
}
