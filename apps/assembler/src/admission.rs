// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Admission by memory. A job's peak is set by its model, not by a core: a
//! convert peaks near 8× its source, a plan near 8 MB per part. One slot per
//! core therefore admits a second multi-gigabyte plan into a pod that has room
//! for one, and the kernel kills the pod. Here every compute holds its
//! estimated megabytes out of a budget read from the container's memory limit,
//! so jobs that fit run together and one that does not waits.
//!
//! Nothing is rejected: a job estimated above the whole budget takes the whole
//! budget and runs alone. CPU is bounded separately by the blocking pool.

use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const MB: u64 = 1024 * 1024;
/// What the idle service holds (runtime, OCCT/FCL statics, HTTP), kept out of
/// the budget.
const BASELINE_MB: u64 = 300;
/// Smallest budget, so a tiny or unreadable limit still admits one job.
const MIN_BUDGET_MB: u64 = 256;
/// Smallest estimate: a kilobyte-sized source still costs a tessellation.
const MIN_ESTIMATE_MB: u64 = 64;
/// Peak memory of a convert, optimize, xbf compaction or render, per byte of source.
const SOURCE_FACTOR: u64 = 8;
/// A plan before its part count is known, per byte of source.
const PLAN_SOURCE_FACTOR: u64 = 10;
const PLAN_MB_PER_PART: u64 = 8;

#[derive(Clone)]
pub struct Admission {
    semaphore: Arc<Semaphore>,
    budget_mb: u32,
}

/// The megabytes one running job holds. Dropping it returns them.
pub struct Grant {
    admission: Admission,
    permit: Option<OwnedSemaphorePermit>,
}

impl Admission {
    pub fn from_env() -> Self {
        Self::with_budget_mb(budget_mb(memory_limit_bytes()))
    }

    pub fn with_budget_mb(budget_mb: u64) -> Self {
        let budget_mb = budget_mb.clamp(1, u32::MAX as u64) as u32;
        Admission {
            semaphore: Arc::new(Semaphore::new(budget_mb as usize)),
            budget_mb,
        }
    }

    pub fn budget_mb(&self) -> u32 {
        self.budget_mb
    }

    fn clamp(&self, estimate_mb: u64) -> u32 {
        estimate_mb.clamp(1, self.budget_mb as u64) as u32
    }

    /// Wait until `estimate_mb` (capped at the whole budget) is free. Waiters
    /// are served in order, so a large job is not starved by small ones.
    pub async fn acquire(&self, estimate_mb: u64) -> Grant {
        let want = self.clamp(estimate_mb);
        if self.semaphore.available_permits() < want as usize {
            eprintln!(
                "assembler: a job is waiting for {want} MB of the {} MB memory budget",
                self.budget_mb
            );
        }
        let permit = Arc::clone(&self.semaphore)
            .acquire_many_owned(want)
            .await
            .expect("admission semaphore is never closed");
        Grant {
            admission: self.clone(),
            permit: Some(permit),
        }
    }

    /// Wait for every running job to finish (shutdown drain).
    pub async fn drain(&self) {
        let _ = self.semaphore.acquire_many(self.budget_mb).await;
    }
}

impl Grant {
    pub fn held_mb(&self) -> u32 {
        self.permit.as_ref().map_or(0, |p| p.num_permits() as u32)
    }

    /// Re-weight a running job once a better estimate is known (a plan's part
    /// count). Shrinking frees the difference at once. Growing takes the
    /// difference if it is free; if not, the job gives back what it holds and
    /// queues for the whole amount — it never waits while holding, so two
    /// growing jobs cannot deadlock each other. During that wait the memory it
    /// already uses is uncounted, bounded by its first estimate.
    pub async fn resize(&mut self, estimate_mb: u64) {
        let target = self.admission.clamp(estimate_mb);
        let held = self.held_mb();
        if target == held {
            return;
        }
        if let Some(permit) = self.permit.as_mut() {
            if target < held {
                drop(permit.split((held - target) as usize));
                return;
            }
            let semaphore = Arc::clone(&self.admission.semaphore);
            if let Ok(extra) = semaphore.try_acquire_many_owned(target - held) {
                permit.merge(extra);
                return;
            }
        }
        self.permit = None;
        self.permit = self.admission.acquire(target as u64).await.permit.take();
    }
}

/// Megabytes a job is expected to peak at, from its source size.
pub fn estimate_mb(source_bytes: u64) -> u64 {
    (source_bytes.saturating_mul(SOURCE_FACTOR) / MB).max(MIN_ESTIMATE_MB)
}

/// A plan's estimate: by part count once known, by source size before.
pub fn plan_estimate_mb(source_bytes: u64, parts: Option<usize>) -> u64 {
    match parts {
        Some(parts) => (parts as u64).saturating_mul(PLAN_MB_PER_PART),
        None => source_bytes.saturating_mul(PLAN_SOURCE_FACTOR) / MB,
    }
    .max(MIN_ESTIMATE_MB)
}

fn budget_mb(limit_bytes: Option<u64>) -> u64 {
    // Unknown limit (not Linux, nothing readable): assume a small machine
    // rather than an unbounded one.
    let limit_mb = limit_bytes.map_or(8 * 1024, |bytes| bytes / MB);
    limit_mb.saturating_sub(BASELINE_MB).max(MIN_BUDGET_MB)
}

/// The container's memory limit, else the machine's memory.
fn memory_limit_bytes() -> Option<u64> {
    let read = |path: &str| std::fs::read_to_string(path).ok();
    let physical = read("/proc/meminfo").and_then(|s| parse_meminfo_total(&s));
    let cgroup = read("/sys/fs/cgroup/memory.max") // cgroup v2
        .or_else(|| read("/sys/fs/cgroup/memory/memory.limit_in_bytes")) // v1
        .and_then(|s| parse_cgroup_limit(&s));
    match (cgroup, physical) {
        // cgroup v1 reports "no limit" as a huge number, not a word.
        (Some(cgroup), Some(physical)) => Some(cgroup.min(physical)),
        (cgroup, physical) => cgroup.or(physical),
    }
}

fn parse_cgroup_limit(contents: &str) -> Option<u64> {
    contents.trim().parse().ok() // "max" (unlimited) does not parse
}

fn parse_meminfo_total(contents: &str) -> Option<u64> {
    let line = contents.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn the_budget_is_the_limit_less_the_baseline() {
        assert_eq!(budget_mb(Some(6 * 1024 * MB)), 6 * 1024 - BASELINE_MB);
        assert_eq!(budget_mb(Some(100 * MB)), MIN_BUDGET_MB);
        assert_eq!(budget_mb(None), 8 * 1024 - BASELINE_MB);
    }

    #[test]
    fn limits_parse_from_the_cgroup_and_meminfo_formats() {
        assert_eq!(parse_cgroup_limit("6442450944\n"), Some(6 * 1024 * MB));
        assert_eq!(parse_cgroup_limit("max\n"), None);
        let meminfo = "MemTotal:       16384000 kB\nMemFree:         1000 kB\n";
        assert_eq!(parse_meminfo_total(meminfo), Some(16_384_000 * 1024));
    }

    #[test]
    fn estimates_follow_the_measured_peaks() {
        assert_eq!(estimate_mb(83 * MB), 664); // measured 665 MB
        assert_eq!(estimate_mb(4 * 1024), MIN_ESTIMATE_MB);
        assert_eq!(plan_estimate_mb(80 * MB, None), 800);
        assert_eq!(plan_estimate_mb(80 * MB, Some(518)), 4144); // measured 4.1 GB
    }

    #[tokio::test]
    async fn jobs_that_fit_run_together_and_the_next_one_waits() {
        let admission = Admission::with_budget_mb(1000);
        let a = admission.acquire(400).await;
        let _b = admission.acquire(400).await;

        let waiting = tokio::spawn({
            let admission = admission.clone();
            async move { admission.acquire(400).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiting.is_finished());

        drop(a);
        assert_eq!(waiting.await.unwrap().held_mb(), 400);
    }

    #[tokio::test]
    async fn a_job_larger_than_the_budget_runs_alone_and_is_never_refused() {
        let admission = Admission::with_budget_mb(1000);
        let small = admission.acquire(100).await;
        let big = tokio::spawn({
            let admission = admission.clone();
            async move { admission.acquire(50_000).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!big.is_finished());

        drop(small);
        assert_eq!(big.await.unwrap().held_mb(), 1000);
    }

    #[tokio::test]
    async fn resizing_shrinks_at_once_and_grows_into_free_room() {
        let admission = Admission::with_budget_mb(1000);
        let mut grant = admission.acquire(800).await;
        grant.resize(200).await;
        assert_eq!(grant.held_mb(), 200);
        assert_eq!(admission.semaphore.available_permits(), 800);

        grant.resize(900).await;
        assert_eq!(grant.held_mb(), 900);
        assert_eq!(admission.semaphore.available_permits(), 100);
    }

    #[tokio::test]
    async fn two_jobs_growing_at_once_do_not_deadlock() {
        let admission = Admission::with_budget_mb(1000);
        let grow = |admission: Admission| async move {
            let mut grant = admission.acquire(400).await;
            tokio::time::sleep(Duration::from_millis(10)).await;
            grant.resize(900).await; // neither can grow while the other holds 400
            assert_eq!(grant.held_mb(), 900);
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        let both = async {
            tokio::join!(
                tokio::spawn(grow(admission.clone())),
                tokio::spawn(grow(admission.clone()))
            )
        };
        let (a, b) = tokio::time::timeout(Duration::from_secs(5), both)
            .await
            .expect("both jobs finish");
        a.unwrap();
        b.unwrap();
        assert_eq!(admission.semaphore.available_permits(), 1000);
    }

    #[tokio::test]
    async fn drain_waits_for_running_jobs() {
        let admission = Admission::with_budget_mb(500);
        let grant = admission.acquire(100).await;
        let drained = tokio::spawn({
            let admission = admission.clone();
            async move { admission.drain().await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!drained.is_finished());
        drop(grant);
        drained.await.unwrap();
    }
}
