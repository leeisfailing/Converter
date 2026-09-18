//! Per-type semaphore-based concurrency control for media operations.
//!
//! Each operation type (download, convert, transcoder, upscale) gets its own
//! semaphore so multiple operations of the same type can run concurrently up to
//! the configured limit. Each running operation carries a unique id and a
//! cancellation flag shared between the caller and the spawned task.
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use tokio::sync::{Semaphore, OwnedSemaphorePermit};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OpType {
    Download,
    Convert,
    Transcoder,
    Upscale,
}

impl OpType {
    pub fn as_str(&self) -> &'static str {
        match self {
            OpType::Download => "download",
            OpType::Convert => "convert",
            OpType::Transcoder => "transcoder",
            OpType::Upscale => "upscale",
        }
    }
}

/// A running operation handle. Dropping this releases the semaphore permit.
pub struct Operation {
    pub id: String,
    pub op_type: OpType,
    cancelled: Arc<AtomicBool>,
    _permit: Option<OwnedSemaphorePermit>,
    active_count: Arc<std::sync::atomic::AtomicUsize>,
    active_ops: Arc<Mutex<std::collections::HashMap<String, OpEntry>>>,
}

impl Drop for Operation {
    fn drop(&mut self) {
        if self._permit.is_some() {
            self.active_count.fetch_sub(1, Ordering::Relaxed);
        }
        if let Ok(mut entries) = self.active_ops.lock() {
            entries.remove(&self.id);
        }
    }
}

impl Operation {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn cancelled_flag(&self) -> Arc<AtomicBool> {
        self.cancelled.clone()
    }

    /// Also wakes idle sidecars which are not currently emitting progress.
    pub async fn wait_cancelled(&self) {
        while !self.is_cancelled() {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }
}

// ── State ──────────────────────────────────────────────────────────────────

struct OpEntry {
    cancelled: Arc<AtomicBool>,
}

/// Manages concurrency limits and active operations per type.
pub struct Operations {
    semaphores: std::collections::HashMap<OpType, Arc<Semaphore>>,
    limits: std::collections::HashMap<OpType, usize>,
    active_counts: std::collections::HashMap<OpType, Arc<std::sync::atomic::AtomicUsize>>,
    active_ops: Arc<Mutex<std::collections::HashMap<String, OpEntry>>>,
}

impl Default for Operations {
    fn default() -> Self {
        Self::from_limits(&crate::system_specs::ConcurrencyInfo {
            download: 1,
            convert: 1,
            transcoder: 1,
            upscale: 1,
        })
    }
}

impl Operations {
    pub fn from_limits(limits: &crate::system_specs::ConcurrencyInfo) -> Operations {
        let mut semaphores = std::collections::HashMap::new();
        let mut limit_map = std::collections::HashMap::new();
        let mut active_counts = std::collections::HashMap::new();
        let pairs = &[
            (OpType::Download, limits.download),
            (OpType::Convert, limits.convert),
            (OpType::Transcoder, limits.transcoder),
            (OpType::Upscale, limits.upscale),
        ];
        for &(t, limit) in pairs {
            let limit = limit.max(1);
            semaphores.insert(t, Arc::new(Semaphore::new(limit)));
            limit_map.insert(t, limit);
            active_counts.insert(t, Arc::new(std::sync::atomic::AtomicUsize::new(0)));
        }
        Operations {
            semaphores,
            limits: limit_map,
            active_counts,
            active_ops: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    /// Acquire a permit for the given operation type with a unique id.
    pub async fn begin(&self, op_type: OpType, id: String) -> Result<Operation, String> {
        let sem = self.semaphores.get(&op_type)
            .ok_or_else(|| format!("Unknown operation type: {}", op_type.as_str()))?;
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut ops = self.active_ops.lock().map_err(|_| "Operation tracking lock poisoned")?;
            if ops.contains_key(&id) {
                return Err(format!("Operation ID is already in use: {id}"));
            }
            ops.insert(id.clone(), OpEntry { cancelled: cancelled.clone() });
        }
        // Register before waiting, and remove registration even if this future
        // is dropped. Otherwise a queued cancellation can start work later.
        let mut operation = Operation { id, op_type, cancelled, _permit: None, active_count: self.active_counts[&op_type].clone(), active_ops: self.active_ops.clone() };
        let permit = tokio::select! {
            biased;
            _ = operation.wait_cancelled() => return Err("Operation was cancelled".into()),
            result = Arc::clone(sem).acquire_owned() => result.map_err(|e| format!("Semaphore closed: {e}"))?,
        };
        if operation.is_cancelled() {
            return Err("Operation was cancelled".into());
        }
        operation.active_count.fetch_add(1, Ordering::Relaxed);
        operation._permit = Some(permit);
        Ok(operation)
    }

    /// Cancel a running operation by id. Returns true if found and cancelled.
    pub fn cancel(&self, id: &str) -> bool {
        if let Ok(ops) = self.active_ops.lock() {
            if let Some(entry) = ops.get(id) {
                entry.cancelled.store(true, Ordering::Release);
                return true;
            }
        }
        false
    }

    /// Cancel all active operations.
    pub fn cancel_all(&self) {
        if let Ok(ops) = self.active_ops.lock() {
            for entry in ops.values() {
                entry.cancelled.store(true, Ordering::Release);
            }
        }
    }

    pub fn active_count(&self, op_type: OpType) -> usize {
        self.active_counts.get(&op_type)
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    pub fn snapshot(&self) -> ConcurrencySnapshot {
        ConcurrencySnapshot {
            download: self.max_permits(OpType::Download),
            convert: self.max_permits(OpType::Convert),
            transcoder: self.max_permits(OpType::Transcoder),
            upscale: self.max_permits(OpType::Upscale),
            active_download: self.active_count(OpType::Download),
            active_convert: self.active_count(OpType::Convert),
            active_transcoder: self.active_count(OpType::Transcoder),
            active_upscale: self.active_count(OpType::Upscale),
        }
    }

    fn max_permits(&self, op_type: OpType) -> usize {
        self.limits.get(&op_type).copied().unwrap_or(0)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcurrencySnapshot {
    pub download: usize,
    pub convert: usize,
    pub transcoder: usize,
    pub upscale: usize,
    pub active_download: usize,
    pub active_convert: usize,
    pub active_transcoder: usize,
    pub active_upscale: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn begin_acquires_permit() {
        let ops = Operations::from_limits(&crate::system_specs::ConcurrencyInfo {
            download: 2, convert: 1, transcoder: 1, upscale: 1,
        });
        let op1 = ops.begin(OpType::Download, "1".into()).await.unwrap();
        assert!(!op1.is_cancelled());
        let op2 = ops.begin(OpType::Download, "2".into()).await.unwrap();
        assert!(!op2.is_cancelled());
        assert_eq!(ops.active_count(OpType::Download), 2);
        drop(op1);
        assert_eq!(ops.active_count(OpType::Download), 1);
        assert!(!ops.cancel("1"));
        drop(op2);
        assert_eq!(ops.active_count(OpType::Download), 0);
    }

    #[tokio::test]
    async fn different_types_are_independent() {
        let ops = Operations::from_limits(&crate::system_specs::ConcurrencyInfo {
            download: 1, convert: 1, transcoder: 1, upscale: 1,
        });
        let _op1 = ops.begin(OpType::Download, "1".into()).await.unwrap();
        let op2 = ops.begin(OpType::Convert, "2".into()).await.unwrap();
        assert!(!op2.is_cancelled());
    }

    #[tokio::test]
    async fn concurrency_respects_limit() {
        let ops = Operations::from_limits(&crate::system_specs::ConcurrencyInfo {
            download: 2, convert: 1, transcoder: 1, upscale: 1,
        });
        let _a = ops.begin(OpType::Download, "a".into()).await.unwrap();
        let _b = ops.begin(OpType::Download, "b".into()).await.unwrap();
        let op = tokio::time::timeout(
            std::time::Duration::from_millis(50),
            ops.begin(OpType::Download, "c".into()),
        ).await;
        assert!(op.is_err(), "Should block when limit reached");
    }

    #[test]
    fn cancel_by_id() {
        let ops = Operations::from_limits(&crate::system_specs::ConcurrencyInfo {
            download: 2, convert: 1, transcoder: 1, upscale: 1,
        });
        // Simulate an active operation
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Ok(mut active) = ops.active_ops.lock() {
            active.insert("test-1".into(), OpEntry { cancelled: cancelled.clone() });
        }
        assert!(!cancelled.load(Ordering::Acquire));
        assert!(ops.cancel("test-1"));
        assert!(cancelled.load(Ordering::Acquire));
        assert!(!ops.cancel("nonexistent"));
    }

    #[tokio::test]
    async fn waiting_operations_can_be_cancelled_without_freeing_a_permit() {
        let ops = Operations::default();
        let running = ops.begin(OpType::Convert, "running".into()).await.unwrap();
        let pending = ops.begin(OpType::Convert, "pending".into());
        tokio::pin!(pending);
        assert!(tokio::time::timeout(std::time::Duration::from_millis(10), &mut pending).await.is_err());
        assert!(ops.cancel("pending"));
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), &mut pending).await.unwrap();
        assert!(result.is_err());
        assert!(!ops.cancel("pending"));
        assert!(!running.is_cancelled());
        assert_eq!(ops.active_count(OpType::Convert), 1);
    }

    #[tokio::test]
    async fn dropped_waiter_cleans_registration_and_duplicate_ids_are_rejected() {
        let ops = Operations::default();
        let running = ops.begin(OpType::Convert, "running".into()).await.unwrap();
        assert!(ops.begin(OpType::Download, "running".into()).await.is_err());
        assert!(tokio::time::timeout(std::time::Duration::from_millis(10),
            ops.begin(OpType::Convert, "pending".into())).await.is_err());
        assert!(!ops.cancel("pending"));
        assert!(ops.cancel("running"));
        assert!(running.is_cancelled());
        assert_eq!(ops.active_count(OpType::Convert), 1);
    }

    #[tokio::test]
    async fn cancellation_wakes_a_silent_operation() {
        let ops = Operations::default();
        let operation = ops.begin(OpType::Convert, "silent".into()).await.unwrap();
        let cancelled = async {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            ops.cancel_all();
        };
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            tokio::join!(operation.wait_cancelled(), cancelled);
        }).await.expect("cancellation should not depend on engine output");
    }
}
