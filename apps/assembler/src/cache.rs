//! Content-addressed result cache for `/convert`. Conversion is a deterministic
//! function of (STEP bytes, deflection, code version), so the same model
//! re-requested (re-plan, re-motion, multiple viewers) skips OCCT tessellation
//! entirely and just re-uploads the cached GLB/graph. This is the throughput
//! lever for the real workload — distinct models are still core-bound, but
//! repeated ones become near-free.

use bytes::Bytes;
use lru::LruCache;
use std::sync::{Arc, Mutex};

/// Single version lever for ALL cached geometry results — the in-process convert
/// LRU (below) AND the Redis job/result-pointer store (`store.rs`). Bump on ANY
/// converter OR planner behavior change so every stale entry, in every cache,
/// auto-misses. This is the "content-hash key + CODE_VERSION" auto-invalidation.
pub const CODE_VERSION: u32 = 1;

pub struct CachedConvert {
    pub glb: Bytes,
    pub graph_bytes: Bytes,
    pub component_count: i64,
    pub triangles: i64,
    pub unit: serde_json::Value,
}

impl CachedConvert {
    fn size(&self) -> usize {
        self.glb.len() + self.graph_bytes.len()
    }
}

struct Inner {
    lru: LruCache<String, Arc<CachedConvert>>,
    bytes: usize,
}

/// Byte-bounded LRU. A single mutex is fine here: the hit path is upload-bound
/// (ms), the lock is held for a map op (ns), and it's only ever taken from
/// sync/blocking contexts — never across an await.
pub struct ResultCache {
    inner: Mutex<Inner>,
    budget: usize,
}

impl ResultCache {
    pub fn new(budget_bytes: usize) -> Self {
        ResultCache {
            inner: Mutex::new(Inner {
                lru: LruCache::unbounded(),
                bytes: 0,
            }),
            budget: budget_bytes,
        }
    }

    /// `content_hash` = xxh3-128 of the STEP bytes, computed while the source
    /// streams to disk (see `http::download_hashed`) — the key costs nothing.
    pub fn key(content_hash: u128, lin: f64, ang: f64) -> String {
        format!("{content_hash:032x}:{lin}:{ang}:v{CODE_VERSION}")
    }

    /// Key from a caller-declared content identity (`source.contentHash`, e.g.
    /// the storage object's etag). Lets a hit skip the download entirely. The
    /// caller vouches that the value changes whenever the bytes change; a
    /// distinct `ch:` keyspace keeps declared keys from ever colliding with
    /// computed byte-hash keys.
    pub fn key_declared(content_hash: &str, lin: f64, ang: f64) -> String {
        format!("ch:{content_hash}:{lin}:{ang}:v{CODE_VERSION}")
    }

    pub fn get(&self, key: &str) -> Option<Arc<CachedConvert>> {
        // LruCache::get bumps recency.
        self.inner.lock().unwrap().lru.get(key).map(Arc::clone)
    }

    pub fn insert(&self, key: String, value: Arc<CachedConvert>) {
        if self.budget == 0 {
            return;
        }
        let size = value.size();
        let mut inner = self.inner.lock().unwrap();
        if let Some((_, old)) = inner.lru.push(key, value) {
            inner.bytes = inner.bytes.saturating_sub(old.size());
        }
        inner.bytes += size;
        while inner.bytes > self.budget {
            match inner.lru.pop_lru() {
                Some((_, v)) => inner.bytes = inner.bytes.saturating_sub(v.size()),
                None => break,
            }
        }
    }
}
