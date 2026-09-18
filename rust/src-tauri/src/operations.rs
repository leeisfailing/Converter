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
    _permit: OwnedSemaphorePermit,
    active_count: Arc<std::sync::atomic::AtomicUsize>,
    active_ops: Arc<Mutex<std::collections::HashMap<String, OpEntry>>>,
}

impl Drop for Operation {
    fn drop(&mut self) {
        self.active_count.fetch_sub(1, Ordering::Relaxed);
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
        let permit = Arc::clone(sem)
            .acquire_owned()
            .await
            .map_err(|e| format!("Semaphore closed: {e}"))?;
        if let Some(c) = self.active_counts.get(&op_type) {
            c.fetch_add(1, Ordering::Relaxed);
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Ok(mut ops) = self.active_ops.lock() {
            ops.insert(id.clone(), OpEntry { cancelled: cancelled.clone() });
        }
        Ok(Operation { id, op_type, cancelled, _permit: permit, active_count: self.active_counts[&op_type].clone(), active_ops: self.active_ops.clone() })
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

    /// Remove an operation from tracking (called on drop).
    pub fn finish(&self, id: &str) {
        if let Ok(mut ops) = self.active_ops.lock() {
            ops.remove(id);
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
}
