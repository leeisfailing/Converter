use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;
use tauri::State;
use tokio::sync::Mutex;

const GPU_CACHE_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub gpu_hits: u64,
    pub gpu_misses: u64,
    pub gpu_entries: usize,
}

struct CacheEntry<T> {
    value: T,
    inserted_at: Instant,
}

pub struct AppCache {
    gpu_cache: Mutex<HashMap<String, CacheEntry<crate::commands::detect::GpuInfo>>>,
    stats: Mutex<CacheStats>,
}

impl Default for AppCache {
    fn default() -> Self {
        Self {
            gpu_cache: Mutex::new(HashMap::new()),
            stats: Mutex::new(CacheStats {
                gpu_hits: 0,
                gpu_misses: 0,
                gpu_entries: 0,
            }),
        }
    }
}

impl AppCache {
    pub async fn get_gpu(&self, key: &str) -> Option<crate::commands::detect::GpuInfo> {
        let cache = self.gpu_cache.lock().await;
        let mut stats = self.stats.lock().await;
        match cache.get(key) {
            Some(entry) if entry.inserted_at.elapsed().as_secs() < GPU_CACHE_TTL_SECS => {
                stats.gpu_hits += 1;
                Some(entry.value.clone())
            }
            _ => {
                stats.gpu_misses += 1;
                None
            }
        }
    }

    pub async fn set_gpu(&self, key: String, value: crate::commands::detect::GpuInfo) {
        let mut cache = self.gpu_cache.lock().await;
        let mut stats = self.stats.lock().await;
        cache.insert(
            key,
            CacheEntry {
                value,
                inserted_at: Instant::now(),
            },
        );
        stats.gpu_entries = cache.len();
    }

    pub async fn clear(&self) {
        let mut gpu_cache = self.gpu_cache.lock().await;
        let mut stats = self.stats.lock().await;
        gpu_cache.clear();
        stats.gpu_entries = 0;
    }

    pub async fn stats(&self) -> CacheStats {
        let gpu_cache = self.gpu_cache.lock().await;
        let mut stats = self.stats.lock().await;
        stats.gpu_entries = gpu_cache.len();
        stats.clone()
    }
}

#[tauri::command]
pub async fn get_cache_stats(cache: State<'_, AppCache>) -> Result<CacheStats, String> {
    Ok(cache.stats().await)
}

#[tauri::command]
pub async fn clear_cache(cache: State<'_, AppCache>) -> Result<(), String> {
    cache.clear().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_gpu(name: &str) -> crate::commands::detect::GpuInfo {
        crate::commands::detect::GpuInfo {
            ok: true,
            available: true,
            encoder: Some("h264_nvenc".into()),
            vendor: Some("NVIDIA".into()),
            hwaccel: Some("cuda".into()),
            name: Some(name.into()),
            message: String::new(),
            all_encoders: vec![],
        }
    }

    #[tokio::test]
    async fn gpu_cache_returns_none_on_miss() {
        let cache = AppCache::default();
        assert!(cache.get_gpu("primary").await.is_none());
    }

    #[tokio::test]
    async fn gpu_cache_returns_value_on_hit() {
        let cache = AppCache::default();
        let gpu = make_gpu("Test GPU");
        cache.set_gpu("primary".into(), gpu.clone()).await;
        let cached = cache.get_gpu("primary").await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().name, Some("Test GPU".into()));
    }

    #[tokio::test]
    async fn gpu_cache_supports_multiple_keys() {
        let cache = AppCache::default();
        cache.set_gpu("gpu1".into(), make_gpu("GPU 1")).await;
        cache.set_gpu("gpu2".into(), make_gpu("GPU 2")).await;
        assert_eq!(cache.get_gpu("gpu1").await.unwrap().name, Some("GPU 1".into()));
        assert_eq!(cache.get_gpu("gpu2").await.unwrap().name, Some("GPU 2".into()));
        let stats = cache.stats().await;
        assert_eq!(stats.gpu_entries, 2);
    }

    #[tokio::test]
    async fn clear_empties_cache() {
        let cache = AppCache::default();
        cache.set_gpu("primary".into(), make_gpu("Test")).await;
        cache.clear().await;
        assert!(cache.get_gpu("primary").await.is_none());
        let stats = cache.stats().await;
        assert_eq!(stats.gpu_entries, 0);
    }

    #[tokio::test]
    async fn stats_track_hits_and_misses() {
        let cache = AppCache::default();
        cache.get_gpu("miss1").await;
        cache.get_gpu("miss2").await;
        cache.set_gpu("key".into(), make_gpu("G")).await;
        cache.get_gpu("key").await;
        let stats = cache.stats().await;
        assert_eq!(stats.gpu_hits, 1);
        assert_eq!(stats.gpu_misses, 2);
    }
}
