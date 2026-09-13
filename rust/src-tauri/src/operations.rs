//! A shared operation lock and cancellation flag for Python and native media jobs.
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};

#[derive(Default)]
pub struct Operations(Arc<Mutex<Option<Arc<AtomicBool>>>>);

pub struct Operation {
    state: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    cancelled: Arc<AtomicBool>,
}

impl Operations {
    pub fn begin(&self) -> Result<Operation, String> {
        let mut active = self.0.lock().map_err(|e| e.to_string())?;
        if active.is_some() { return Err("An operation is already in progress".into()); }
        let cancelled = Arc::new(AtomicBool::new(false));
        *active = Some(cancelled.clone());
        Ok(Operation { state: self.0.clone(), cancelled })
    }

    pub fn cancel(&self) {
        if let Ok(active) = self.0.lock() {
            if let Some(cancelled) = active.as_ref() { cancelled.store(true, Ordering::Release); }
        }
    }
}

impl Operation {
    pub fn is_cancelled(&self) -> bool { self.cancelled.load(Ordering::Acquire) }
}

impl Drop for Operation {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.lock() { *active = None; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn operations_remain_exclusive_until_cleanup() {
        let state = Operations::default();
        let first = state.begin().unwrap();
        state.cancel();
        assert!(first.is_cancelled());
        assert!(state.begin().is_err());
        drop(first);
        let next = state.begin().unwrap();
        assert!(!next.is_cancelled());
    }
}
