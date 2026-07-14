//! Live per-job convert progress, served by `GET /convert/status/{jobId}` so
//! the app can render a real phase checklist instead of a bare spinner.
//! Entries exist only while a convert is in flight; unknown id => 404 and the
//! caller falls back to its coarse DB status.

use dashmap::DashMap;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

pub const PHASE_DOWNLOAD: u8 = 0;
pub const PHASE_CONVERT: u8 = 1;
pub const PHASE_UPLOAD: u8 = 2;

pub struct JobProgress {
    phase: AtomicU8,
    /// Bytes downloaded so far (only meaningful in the download phase).
    pub done: AtomicU64,
    /// Total bytes when known from Content-Length, else 0.
    pub total: AtomicU64,
}

impl JobProgress {
    pub fn set_phase(&self, phase: u8) {
        self.phase.store(phase, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> (&'static str, u64, u64) {
        let phase = match self.phase.load(Ordering::Relaxed) {
            PHASE_DOWNLOAD => "downloading",
            PHASE_CONVERT => "converting",
            _ => "uploading",
        };
        (
            phase,
            self.done.load(Ordering::Relaxed),
            self.total.load(Ordering::Relaxed),
        )
    }
}

#[derive(Clone, Default)]
pub struct ProgressStore {
    inner: Arc<DashMap<String, Arc<JobProgress>>>,
}

impl ProgressStore {
    /// Register a job and get a guard that removes it when the request ends
    /// (success or error) — a finished job must read as 404, not a stale phase.
    pub fn start(&self, job_id: &str) -> ProgressGuard {
        let progress = Arc::new(JobProgress {
            phase: AtomicU8::new(PHASE_DOWNLOAD),
            done: AtomicU64::new(0),
            total: AtomicU64::new(0),
        });
        self.inner.insert(job_id.to_string(), Arc::clone(&progress));
        ProgressGuard {
            store: self.clone(),
            job_id: job_id.to_string(),
            progress,
        }
    }

    pub fn get(&self, job_id: &str) -> Option<Arc<JobProgress>> {
        self.inner.get(job_id).map(|e| Arc::clone(e.value()))
    }
}

pub struct ProgressGuard {
    store: ProgressStore,
    job_id: String,
    pub progress: Arc<JobProgress>,
}

impl Drop for ProgressGuard {
    fn drop(&mut self) {
        // Only clear the entry THIS guard created: a concurrent start() for the
        // same job_id (an idempotent retry) may have replaced it, and that newer
        // live entry must survive so its GET /convert/status stays valid.
        self.store
            .inner
            .remove_if(&self.job_id, |_, v| Arc::ptr_eq(v, &self.progress));
    }
}
