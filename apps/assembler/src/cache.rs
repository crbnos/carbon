// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Content-addressed result cache for `/convert`. Conversion is a deterministic
//! function of (STEP bytes, deflection, code version), so the same model
//! re-requested (re-plan, re-motion, multiple viewers) skips OCCT tessellation
//! entirely and just re-uploads the cached GLB/graph. This is the throughput
//! lever for the real workload — distinct models are still core-bound, but
//! repeated ones become near-free.
//!
//! The entries are files, memory-mapped when served: the page cache holds them,
//! the kernel can drop them under pressure, and the process's own memory stays
//! flat however much is cached. (Held on the heap, half a gigabyte of GLBs sat
//! in a small pod for as long as it ran.)

use bytes::Bytes;
use lru::LruCache;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Single version lever for ALL cached geometry results — the convert cache
/// (below) AND the Redis job/result-pointer store (`jobs.rs`). Bump on ANY
/// converter OR planner behavior change so every stale entry, in every cache,
/// auto-misses. This is the "content-hash key + CODE_VERSION" auto-invalidation.
// v3: geometry_hash recipe changed to position-only (nodeIds renamed globally).
pub const CODE_VERSION: u32 = 3;

pub struct CachedConvert {
    pub glb: Bytes,
    pub graph_bytes: Bytes,
    pub component_count: i64,
    pub triangles: i64,
    pub unit: serde_json::Value,
}

impl CachedConvert {
    fn size(&self) -> u64 {
        (self.glb.len() + self.graph_bytes.len()) as u64
    }
}

struct Inner {
    /// Key → the bytes its files take.
    lru: LruCache<String, u64>,
    bytes: u64,
}

/// Byte-bounded LRU of files under `dir`. A single mutex is fine here: it
/// guards the index only (a map op), never the file I/O.
pub struct ResultCache {
    dir: PathBuf,
    inner: Mutex<Inner>,
    budget: u64,
}

impl ResultCache {
    /// An empty cache in `dir`. Whatever a previous process left there is
    /// removed: its index is gone, so nothing could ever evict those files.
    pub fn new(dir: PathBuf, budget_bytes: u64) -> Self {
        let _ = std::fs::remove_dir_all(&dir);
        if budget_bytes > 0 {
            if let Err(e) = std::fs::create_dir_all(&dir) {
                eprintln!("assembler: convert cache disabled ({}: {e})", dir.display());
            }
        }
        ResultCache {
            dir,
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

    /// A key's file stem. Keys carry a caller-declared hash, so the name is a
    /// hash of the key, never the key.
    fn path(&self, key: &str, extension: &str) -> PathBuf {
        let name = xxhash_rust::xxh3::xxh3_128(key.as_bytes());
        self.dir.join(format!("{name:032x}.{extension}"))
    }

    pub fn get(&self, key: &str) -> Option<Arc<CachedConvert>> {
        // LruCache::get bumps recency.
        self.inner.lock().unwrap().lru.get(key)?;
        let entry = self.read(key);
        if entry.is_none() {
            // The files are gone or unreadable: forget the key.
            self.forget(key);
        }
        entry.map(Arc::new)
    }

    fn read(&self, key: &str) -> Option<CachedConvert> {
        let meta = std::fs::read(self.path(key, "json")).ok()?;
        let meta: serde_json::Value = serde_json::from_slice(&meta).ok()?;
        Some(CachedConvert {
            glb: crate::http::map_file(&self.path(key, "glb")).ok()?,
            graph_bytes: crate::http::map_file(&self.path(key, "graph")).ok()?,
            component_count: meta["componentCount"].as_i64()?,
            triangles: meta["triangles"].as_i64()?,
            unit: meta["unit"].clone(),
        })
    }

    /// Store a fresh result and hand it back backed by its files, so the heap
    /// copy dies with this call. When it cannot be stored (cache off, entry
    /// larger than the budget, disk full) the result is returned as it came.
    pub fn insert(&self, key: String, value: CachedConvert) -> Arc<CachedConvert> {
        let size = value.size();
        if self.budget == 0 || size > self.budget {
            return Arc::new(value);
        }
        let stored = self.write(&key, &value).and_then(|()| {
            self.read(&key)
                .ok_or_else(|| std::io::Error::other("could not read the entry back"))
        });
        let entry = match stored {
            Ok(entry) => entry,
            Err(e) => {
                eprintln!("assembler: convert result not cached: {e}");
                self.remove_files(&key);
                return Arc::new(value);
            }
        };

        let mut evicted = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            if let Some((_, old)) = inner.lru.push(key, size) {
                inner.bytes = inner.bytes.saturating_sub(old);
            }
            inner.bytes += size;
            while inner.bytes > self.budget {
                match inner.lru.pop_lru() {
                    Some((key, size)) => {
                        inner.bytes = inner.bytes.saturating_sub(size);
                        evicted.push(key);
                    }
                    None => break,
                }
            }
        }
        // An entry still being uploaded keeps its mapping: unlinking a mapped
        // file only frees the disk once the last map is dropped.
        for key in evicted {
            self.remove_files(&key);
        }
        Arc::new(entry)
    }

    fn write(&self, key: &str, value: &CachedConvert) -> std::io::Result<()> {
        let meta = serde_json::json!({
            "componentCount": value.component_count,
            "triangles": value.triangles,
            "unit": value.unit,
        });
        // Each file lands under its final name by rename, so a concurrent reader
        // of the same key sees a whole file or none.
        for (extension, bytes) in [
            ("glb", &value.glb[..]),
            ("graph", &value.graph_bytes[..]),
            ("json", meta.to_string().as_bytes()),
        ] {
            let path = self.path(key, extension);
            let tmp = unique_tmp(&path);
            std::fs::write(&tmp, bytes)?;
            std::fs::rename(&tmp, &path)?;
        }
        Ok(())
    }

    fn forget(&self, key: &str) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(size) = inner.lru.pop(key) {
            inner.bytes = inner.bytes.saturating_sub(size);
        }
        drop(inner);
        self.remove_files(key);
    }

    fn remove_files(&self, key: &str) {
        for extension in ["glb", "graph", "json"] {
            let _ = std::fs::remove_file(self.path(key, extension));
        }
    }
}

fn unique_tmp(path: &Path) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    path.with_extension(format!("tmp{n}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(glb: &[u8], graph: &[u8]) -> CachedConvert {
        CachedConvert {
            glb: Bytes::copy_from_slice(glb),
            graph_bytes: Bytes::copy_from_slice(graph),
            component_count: 3,
            triangles: 12,
            unit: serde_json::json!({ "name": "mm" }),
        }
    }

    fn cache(budget: u64) -> (tempfile::TempDir, ResultCache) {
        let dir = tempfile::tempdir().unwrap();
        let cache = ResultCache::new(dir.path().join("cache"), budget);
        (dir, cache)
    }

    #[test]
    fn a_stored_result_is_served_back_from_its_files() {
        let (_dir, cache) = cache(1024);
        assert!(cache.get("k").is_none());

        let stored = cache.insert("k".into(), entry(b"glb-bytes", b"{\"graph\":1}"));
        assert_eq!(&stored.glb[..], b"glb-bytes");

        let hit = cache.get("k").unwrap();
        assert_eq!(&hit.glb[..], b"glb-bytes");
        assert_eq!(&hit.graph_bytes[..], b"{\"graph\":1}");
        assert_eq!((hit.component_count, hit.triangles), (3, 12));
        assert_eq!(hit.unit["name"], "mm");
    }

    #[test]
    fn the_least_recently_used_entry_goes_when_the_budget_is_passed() {
        let (dir, cache) = cache(25);
        cache.insert("a".into(), entry(b"0123456789", b""));
        cache.insert("b".into(), entry(b"0123456789", b""));
        cache.get("a").unwrap(); // a is now the more recent
        cache.insert("c".into(), entry(b"0123456789", b""));

        assert!(cache.get("b").is_none());
        assert!(cache.get("a").is_some() && cache.get("c").is_some());
        // Three files per entry, two entries left.
        let files = std::fs::read_dir(dir.path().join("cache")).unwrap().count();
        assert_eq!(files, 6);
    }

    #[test]
    fn an_evicted_entry_stays_readable_by_whoever_already_holds_it() {
        let (_dir, cache) = cache(10);
        let held = cache.insert("a".into(), entry(b"0123456789", b""));
        cache.insert("b".into(), entry(b"9876543210", b""));
        assert!(cache.get("a").is_none());
        assert_eq!(&held.glb[..], b"0123456789");
    }

    #[test]
    fn a_result_that_cannot_be_stored_is_still_returned() {
        let (_dir, off) = cache(0);
        assert_eq!(&off.insert("k".into(), entry(b"x", b"y")).glb[..], b"x");
        assert!(off.get("k").is_none());

        let (_dir, small) = cache(4);
        assert_eq!(&small.insert("k".into(), entry(b"too-large", b"")).glb[..], b"too-large");
        assert!(small.get("k").is_none());
    }

    #[test]
    fn files_from_a_previous_process_are_cleared_at_startup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache");
        ResultCache::new(path.clone(), 1024).insert("k".into(), entry(b"x", b"y"));
        assert_eq!(std::fs::read_dir(&path).unwrap().count(), 3);

        let restarted = ResultCache::new(path.clone(), 1024);
        assert!(restarted.get("k").is_none());
        assert_eq!(std::fs::read_dir(&path).unwrap().count(), 0);
    }
}
