//! Persistent disk cache for file detection, probe results, and encoder tests.
//!
//! Survives app restarts so that re-opening the app and processing the same
//! file skips redundant ffprobe / GPU encoder tests.  Entries expire after
//! `TTL_SECS` and the store is capped at `MAX_ENTRIES` (oldest evicted first).
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::SystemTime;
use tokio::sync::Mutex;

const TTL_SECS: u64 = 86400; // 24 hours
const MAX_ENTRIES: usize = 500;

// ── Public types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_entries: usize,
    pub file_hits: u64,
    pub file_misses: u64,
    pub encoder_hits: u64,
    pub encoder_misses: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    data: EntryData,
    /// Unix timestamp when the entry was created.
    created_at: u64,
    /// File size in bytes (used for invalidation).
    file_size: Option<u64>,
    /// File mtime as Unix timestamp (used for invalidation).
    file_mtime: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum EntryData {
    /// Cached ffprobe / detect_file result.
    #[serde(rename = "probe")]
    Probe { result: serde_json::Value },
    /// Cached GPU encoder test result.
    #[serde(rename = "encoder")]
    Encoder { works: bool },
    /// Cached file type detection.
    #[serde(rename = "detection")]
    Detection { result: serde_json::Value },
}

// ── Persistent store ─────────────────────────────────────────────────────

struct CacheStore {
    entries: HashMap<String, Entry>,
    stats: CacheStatsInner,
}

#[derive(Default)]
struct CacheStatsInner {
    file_hits: u64,
    file_misses: u64,
    encoder_hits: u64,
    encoder_misses: u64,
}

#[derive(Clone)]
pub struct PersistentCache {
    inner: Arc<Mutex<CacheStore>>,
    /// Path to the JSON file on disk.
    path: PathBuf,
}

fn cache_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    config_dir.join("Converter").join("cache.json")
}

impl PersistentCache {
    /// Get or create the global persistent cache instance.
    pub fn global() -> &'static Self {
        static INSTANCE: OnceLock<PersistentCache> = OnceLock::new();
        INSTANCE.get_or_init(|| {
            let path = cache_path();
            let entries = load_from_disk(&path);
            log::info!("Loaded {} cached entries from disk", entries.len());
            PersistentCache {
                inner: Arc::new(Mutex::new(CacheStore {
                    entries,
                    stats: CacheStatsInner::default(),
                })),
                path,
            }
        })
    }

    /// Look up a file-related cache entry (probe or detection).
    /// `key` is typically the file path.  `file_size` and `file_mtime` are used
    /// to invalidate stale entries if the file was modified.
    pub async fn get_file(&self, key: &str, file_size: Option<u64>, file_mtime: Option<u64>) -> Option<serde_json::Value> {
        let mut store = self.inner.lock().await;
        let now = unix_now();
        let result = if let Some(entry) = store.entries.get(key) {
            // Check TTL
            if now.saturating_sub(entry.created_at) > TTL_SECS {
                store.entries.remove(key);
                None
            }
            // Check file invalidation
            else if let (Some(sz), Some(mt)) = (file_size, file_mtime) {
                if entry.file_size != Some(sz) || entry.file_mtime != Some(mt) {
                    store.entries.remove(key);
                    None
                } else {
                    match &entry.data {
                        EntryData::Probe { result } | EntryData::Detection { result } => Some(result.clone()),
                        _ => None,
                    }
                }
            } else {
                match &entry.data {
                    EntryData::Probe { result } | EntryData::Detection { result } => Some(result.clone()),
                    _ => None,
                }
            }
        } else {
            None
        };
        if result.is_some() {
            store.stats.file_hits += 1;
        } else {
            store.stats.file_misses += 1;
        }
        result
    }

    /// Cache a file-related result (probe or detection).
    pub async fn set_file(&self, key: &str, result: serde_json::Value, file_size: Option<u64>, file_mtime: Option<u64>) {
        let mut store = self.inner.lock().await;
        evict_if_needed(&mut store.entries);
        store.entries.insert(
            key.to_string(),
            Entry {
                data: EntryData::Probe { result },
                created_at: unix_now(),
                file_size,
                file_mtime,
            },
        );
    }

    /// Cache a file detection result.
    pub async fn set_detection(&self, key: &str, result: serde_json::Value, file_size: Option<u64>, file_mtime: Option<u64>) {
        let mut store = self.inner.lock().await;
        evict_if_needed(&mut store.entries);
        store.entries.insert(
            key.to_string(),
            Entry {
                data: EntryData::Detection { result },
                created_at: unix_now(),
                file_size,
                file_mtime,
            },
        );
    }

    /// Look up an encoder test result.
    pub async fn get_encoder(&self, encoder: &str) -> Option<bool> {
        let mut store = self.inner.lock().await;
        let now = unix_now();
        let result = if let Some(entry) = store.entries.get(encoder) {
            if now.saturating_sub(entry.created_at) > TTL_SECS {
                store.entries.remove(encoder);
                None
            } else {
                match &entry.data {
                    EntryData::Encoder { works } => Some(*works),
                    _ => None,
                }
            }
        } else {
            None
        };
        if result.is_some() {
            store.stats.encoder_hits += 1;
        } else {
            store.stats.encoder_misses += 1;
        }
        result
    }

    /// Cache an encoder test result.
    pub async fn set_encoder(&self, encoder: &str, works: bool) {
        let mut store = self.inner.lock().await;
        evict_if_needed(&mut store.entries);
        store.entries.insert(
            encoder.to_string(),
            Entry {
                data: EntryData::Encoder { works },
                created_at: unix_now(),
                file_size: None,
                file_mtime: None,
            },
        );
    }

    /// Get cache statistics.
    pub async fn stats(&self) -> CacheStats {
        let store = self.inner.lock().await;
        CacheStats {
            total_entries: store.entries.len(),
            file_hits: store.stats.file_hits,
            file_misses: store.stats.file_misses,
            encoder_hits: store.stats.encoder_hits,
            encoder_misses: store.stats.encoder_misses,
        }
    }

    /// Clear all cached entries and remove the disk file.
    pub async fn clear(&self) {
        let mut store = self.inner.lock().await;
        store.entries.clear();
        store.stats = CacheStatsInner::default();
        let _ = tokio::fs::remove_file(&self.path).await;
    }

    /// Flush the current cache to disk.
    pub async fn flush(&self) {
        let store = self.inner.lock().await;
        save_to_disk(&self.path, &store.entries);
    }

    /// Load cache from disk and return entries.
    fn load_entries() -> HashMap<String, Entry> {
        load_from_disk(&cache_path())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn evict_if_needed(entries: &mut HashMap<String, Entry>) {
    if entries.len() <= MAX_ENTRIES {
        return;
    }
    // Find and remove oldest entries until we're under the limit
    let excess = entries.len() - MAX_ENTRIES;
    let mut ages: Vec<(u64, String)> = entries
        .iter()
        .map(|(k, v)| (v.created_at, k.clone()))
        .collect();
    ages.sort_unstable_by_key(|(age, _)| *age);
    for (_, key) in ages.into_iter().take(excess) {
        entries.remove(&key);
    }
}

fn load_from_disk(path: &PathBuf) -> HashMap<String, Entry> {
    let data = match std::fs::read_to_string(path) {
        Ok(data) => data,
        Err(_) => return HashMap::new(),
    };
    let mut entries: HashMap<String, Entry> = match serde_json::from_str(&data) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("Failed to parse cache file: {e}");
            return HashMap::new();
        }
    };
    // Remove expired entries on load
    let now = unix_now();
    entries.retain(|_, entry| now.saturating_sub(entry.created_at) <= TTL_SECS);
    entries
}

fn save_to_disk(path: &PathBuf, entries: &HashMap<String, Entry>) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(entries) {
        Ok(json) => {
            if let Err(e) = std::fs::write(path, json) {
                log::warn!("Failed to write cache file: {e}");
            }
        }
        Err(e) => {
            log::warn!("Failed to serialize cache: {e}");
        }
    }
}

// ── Tauri commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_persistent_cache_stats(
    cache: tauri::State<'_, PersistentCache>,
) -> Result<CacheStats, String> {
    Ok(cache.stats().await)
}

#[tauri::command]
pub async fn clear_persistent_cache(
    cache: tauri::State<'_, PersistentCache>,
) -> Result<(), String> {
    cache.clear().await;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_and_get_encoder() {
        let cache = PersistentCache {
            inner: Arc::new(Mutex::new(CacheStore {
                entries: HashMap::new(),
                stats: CacheStatsInner::default(),
            })),
            path: PathBuf::from("/tmp/test-cache.json"),
        };
        cache.set_encoder("h264_nvenc", true).await;
        assert_eq!(cache.get_encoder("h264_nvenc").await, Some(true));
        assert_eq!(cache.get_encoder("unknown").await, None);
    }

    #[tokio::test]
    async fn set_and_get_file() {
        let cache = PersistentCache {
            inner: Arc::new(Mutex::new(CacheStore {
                entries: HashMap::new(),
                stats: CacheStatsInner::default(),
            })),
            path: PathBuf::from("/tmp/test-cache.json"),
        };
        let result = serde_json::json!({"ok": true, "type": "video"});
        cache.set_file("/tmp/test.mp4", result.clone(), Some(1024), Some(1000)).await;
        assert_eq!(cache.get_file("/tmp/test.mp4", Some(1024), Some(1000)).await, Some(result));
    }

    #[tokio::test]
    async fn stale_entry_invalidated() {
        let cache = PersistentCache {
            inner: Arc::new(Mutex::new(CacheStore {
                entries: HashMap::new(),
                stats: CacheStatsInner::default(),
            })),
            path: PathBuf::from("/tmp/test-cache.json"),
        };
        let result = serde_json::json!({"ok": true});
        cache.set_file("/tmp/test.mp4", result, Some(1024), Some(1000)).await;
        // Different file size → cache miss
        assert!(cache.get_file("/tmp/test.mp4", Some(2048), Some(1000)).await.is_none());
    }

    #[tokio::test]
    async fn stats_tracking() {
        let cache = PersistentCache {
            inner: Arc::new(Mutex::new(CacheStore {
                entries: HashMap::new(),
                stats: CacheStatsInner::default(),
            })),
            path: PathBuf::from("/tmp/test-cache.json"),
        };
        cache.get_encoder("a").await;
        cache.set_encoder("a", true).await;
        cache.get_encoder("a").await;
        let stats = cache.stats().await;
        assert_eq!(stats.encoder_hits, 1);
        assert_eq!(stats.encoder_misses, 1);
    }
}
