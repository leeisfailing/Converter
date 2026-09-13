use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;
use tauri::State;
use tokio::sync::Mutex;

const MAX_URL_CACHE_ENTRIES: usize = 64;
const GPU_CACHE_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub url_hits: u64,
    pub url_misses: u64,
    pub gpu_hits: u64,
    pub gpu_misses: u64,
    pub url_entries: usize,
    pub gpu_cached: bool,
}

struct CacheEntry<T> {
    value: T,
    inserted_at: Instant,
}

pub struct AppCache {
    url_cache: Mutex<HashMap<String, CacheEntry<serde_json::Value>>>,
    gpu_cache: Mutex<Option<CacheEntry<crate::commands::detect::GpuInfo>>>,
    stats: Mutex<CacheStats>,
}

impl Default for AppCache {
    fn default() -> Self {
        Self {
            url_cache: Mutex::new(HashMap::new()),
            gpu_cache: Mutex::new(None),
            stats: Mutex::new(CacheStats {
                url_hits: 0,
                url_misses: 0,
                gpu_hits: 0,
                gpu_misses: 0,
                url_entries: 0,
                gpu_cached: false,
            }),
        }
    }
}

impl AppCache {
    pub async fn get_url(&self, url: &str) -> Option<serde_json::Value> {
        let cache = self.url_cache.lock().await;
        let mut stats = self.stats.lock().await;
        match cache.get(url) {
            Some(entry) => {
                stats.url_hits += 1;
                Some(entry.value.clone())
            }
            None => {
                stats.url_misses += 1;
                None
            }
        }
    }

    pub async fn set_url(&self, url: String, value: serde_json::Value) {
        let mut cache = self.url_cache.lock().await;
        let mut stats = self.stats.lock().await;
        if cache.len() >= MAX_URL_CACHE_ENTRIES {
            if let Some(oldest_key) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.inserted_at)
                .map(|(k, _)| k.clone())
            {
                cache.remove(&oldest_key);
            }
        }
        cache.insert(
            url,
            CacheEntry {
                value,
                inserted_at: Instant::now(),
            },
        );
        stats.url_entries = cache.len();
    }

    pub async fn get_gpu(&self) -> Option<crate::commands::detect::GpuInfo> {
        let cache = self.gpu_cache.lock().await;
        let mut stats = self.stats.lock().await;
        match cache.as_ref() {
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

    pub async fn set_gpu(&self, value: crate::commands::detect::GpuInfo) {
        let mut cache = self.gpu_cache.lock().await;
        let mut stats = self.stats.lock().await;
        *cache = Some(CacheEntry {
            value,
            inserted_at: Instant::now(),
        });
        stats.gpu_cached = true;
    }

    pub async fn clear(&self) {
        let mut url_cache = self.url_cache.lock().await;
        let mut gpu_cache = self.gpu_cache.lock().await;
        let mut stats = self.stats.lock().await;
        url_cache.clear();
        *gpu_cache = None;
        stats.url_entries = 0;
        stats.gpu_cached = false;
    }

    pub async fn stats(&self) -> CacheStats {
        let url_cache = self.url_cache.lock().await;
        let gpu_cache = self.gpu_cache.lock().await;
        let mut stats = self.stats.lock().await;
        stats.url_entries = url_cache.len();
        stats.gpu_cached = gpu_cache.is_some();
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
    use serde_json::json;

    #[tokio::test]
    async fn url_cache_returns_none_on_miss() {
        let cache = AppCache::default();
        assert!(cache.get_url("https://example.com").await.is_none());
    }

    #[tokio::test]
    async fn url_cache_returns_value_on_hit() {
        let cache = AppCache::default();
        let value = json!({"ok": true, "title": "Test"});
        cache.set_url("https://example.com".into(), value.clone()).await;
        assert_eq!(cache.get_url("https://example.com").await, Some(value));
    }

    #[tokio::test]
    async fn url_cache_evicts_oldest_when_full() {
        let cache = AppCache::default();
        for i in 0..=MAX_URL_CACHE_ENTRIES {
            cache.set_url(format!("https://example.com/{i}"), json!({"i": i})).await;
        }
        let stats = cache.stats().await;
        assert!(stats.url_entries <= MAX_URL_CACHE_ENTRIES);
    }

    #[tokio::test]
    async fn gpu_cache_respects_ttl() {
        let cache = AppCache::default();
        let gpu = crate::commands::detect::GpuInfo {
            ok: true,
            available: true,
            encoder: Some("h264_nvenc".into()),
            vendor: Some("NVIDIA".into()),
            hwaccel: Some("cuda".into()),
            name: Some("Test GPU".into()),
            message: String::new(),
            all_encoders: vec![],
        };
        cache.set_gpu(gpu.clone()).await;
        assert!(cache.get_gpu().await.is_some());
    }

    #[tokio::test]
    async fn clear_empties_all_caches() {
        let cache = AppCache::default();
        cache.set_url("https://example.com".into(), json!({"ok": true})).await;
        cache.clear().await;
        assert!(cache.get_url("https://example.com").await.is_none());
        let stats = cache.stats().await;
        assert_eq!(stats.url_entries, 0);
    }
}
