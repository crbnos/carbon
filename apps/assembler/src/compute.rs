// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! A job's blocking compute, bounded. OCCT and FCL calls cannot be interrupted
//! and a blocking thread cannot be killed, so a compute that hangs (or is
//! canceled) is not stopped: the job ends at once, and the thread finishes in
//! the background still holding the job's memory grant, so admission never
//! counts as free the memory that thread may still be using.

use crate::{admission::Grant, jobs, telemetry};
use std::time::Duration;

/// The longest a compute may run before its job fails. Lambda's own 900 s
/// timeout comes first there; this bounds the standing service, which has
/// none. Generous: the largest plans take tens of minutes.
pub const COMPUTE_DEADLINE: Duration = Duration::from_secs(60 * 60);

pub enum ComputeFailure {
    Panicked(String),
    TimedOut,
    Canceled,
}

impl ComputeFailure {
    /// The job's error code: the action's own for a panic.
    pub fn code(&self, panic_code: &'static str) -> &'static str {
        match self {
            ComputeFailure::Panicked(_) => panic_code,
            ComputeFailure::TimedOut => "COMPUTE_TIMEOUT",
            ComputeFailure::Canceled => "canceled",
        }
    }
}

impl std::fmt::Display for ComputeFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ComputeFailure::Panicked(e) => write!(f, "panicked: {e}"),
            ComputeFailure::TimedOut => write!(
                f,
                "did not finish within {} minutes",
                COMPUTE_DEADLINE.as_secs() / 60
            ),
            ComputeFailure::Canceled => write!(f, "was canceled"),
        }
    }
}

/// Run `work` on the blocking pool in a `compute` span, until it returns, the
/// deadline passes, or the job is canceled. `grant` is held until the thread
/// really finishes, whichever comes first.
pub async fn run<T: Send + 'static>(
    grant: Option<Grant>,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, ComputeFailure> {
    bounded(grant, work, COMPUTE_DEADLINE).await
}

async fn bounded<T: Send + 'static>(
    grant: Option<Grant>,
    work: impl FnOnce() -> T + Send + 'static,
    deadline: Duration,
) -> Result<T, ComputeFailure> {
    let mut handle = tokio::task::spawn_blocking(work);
    let cancel = jobs::current_cancel();
    let canceled = async {
        match &cancel {
            Some(token) => token.cancelled().await,
            None => std::future::pending().await,
        }
    };
    let finished = telemetry::in_span("compute", async {
        tokio::select! {
            joined = &mut handle => Some(joined),
            _ = tokio::time::sleep(deadline) => None,
            _ = canceled => None,
        }
    })
    .await;
    match finished {
        Some(joined) => {
            drop(grant);
            joined.map_err(|e| ComputeFailure::Panicked(e.to_string()))
        }
        None => {
            let timed_out = !cancel.as_ref().is_some_and(|t| t.is_cancelled());
            // The thread runs on; its memory stays counted until it is done.
            tokio::spawn(async move {
                let _ = handle.await;
                drop(grant);
            });
            Err(if timed_out {
                ComputeFailure::TimedOut
            } else {
                ComputeFailure::Canceled
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admission::Admission;

    #[tokio::test]
    async fn a_compute_past_its_deadline_fails_but_keeps_its_memory_until_done() {
        let admission = Admission::with_budget_mb(100);
        let grant = admission.acquire(100).await;
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let failed = bounded(Some(grant), move || wait.recv().unwrap(), Duration::from_millis(50))
            .await
            .err()
            .unwrap();
        assert!(matches!(failed, ComputeFailure::TimedOut));

        // The thread is still running: its 100 MB are still taken.
        let next = tokio::time::timeout(Duration::from_millis(100), admission.acquire(100)).await;
        assert!(next.is_err(), "memory was handed out while the thread still used it");

        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(1), admission.acquire(100))
            .await
            .expect("memory is free once the thread is done");
    }

    #[tokio::test]
    async fn a_compute_that_finishes_returns_its_value() {
        assert_eq!(bounded(None, || 7, Duration::from_secs(5)).await.ok(), Some(7));
    }

    #[tokio::test]
    async fn a_canceled_job_stops_waiting_on_its_compute() {
        let job = crate::jobs::track("cancel-compute", async {
            crate::jobs::current_cancel().unwrap().cancel();
            bounded(None, || std::thread::sleep(Duration::from_millis(200)), Duration::from_secs(5)).await
        });
        assert!(matches!(job.await.err().unwrap(), ComputeFailure::Canceled));
    }
}
