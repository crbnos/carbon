// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Downloaded sources, bounded. Every job downloads its source before it waits
//! for memory, so without a bound a queue of N jobs held N sources on disk at
//! once. A job now takes a slot before it downloads and holds it until its
//! `Source` drops, which also deletes the file — on every path, a panic
//! included.

use crate::{error::ApiError, http, progress::JobProgress};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// The slots: how many downloaded sources may exist at once.
#[derive(Clone)]
pub struct Sources {
    slots: Arc<Semaphore>,
}

/// One downloaded source on disk. Dropping it deletes the file and frees the
/// slot.
pub struct Source {
    path: PathBuf,
    /// xxh3-128 of the (decompressed) bytes.
    pub hash: u128,
    _slot: OwnedSemaphorePermit,
}

impl Sources {
    pub fn new(slots: usize) -> Self {
        Sources {
            slots: Arc::new(Semaphore::new(slots.max(1))),
        }
    }

    /// Wait for a slot, then download `url` to a temp file named `*.{ext}`.
    pub async fn download(
        &self,
        url: &str,
        ext: &str,
        progress: Option<&JobProgress>,
    ) -> Result<Source, ApiError> {
        self.download_with(url, ext, progress, &http::DownloadOpts::default())
            .await
    }

    pub async fn download_with(
        &self,
        url: &str,
        ext: &str,
        progress: Option<&JobProgress>,
        opts: &http::DownloadOpts<'_>,
    ) -> Result<Source, ApiError> {
        let slot = Arc::clone(&self.slots)
            .acquire_owned()
            .await
            .expect("source semaphore is never closed");
        let path = http::temp_path(ext);
        match http::download_with(url, &path, progress, opts).await {
            Ok(hash) => Ok(Source {
                path,
                hash,
                _slot: slot,
            }),
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                Err(e)
            }
        }
    }
}

impl Source {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

impl Drop for Source {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_source_is_deleted_and_its_slot_freed_when_it_drops() {
        let sources = Sources::new(1);
        let path = http::temp_path("step");
        std::fs::write(&path, b"ISO-10303-21;").unwrap();
        let slot = Arc::clone(&sources.slots).acquire_owned().await.unwrap();
        let source = Source {
            path: path.clone(),
            hash: 0,
            _slot: slot,
        };
        assert_eq!(sources.slots.available_permits(), 0);
        drop(source);
        assert!(!path.exists());
        assert_eq!(sources.slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn a_failed_download_leaves_no_file_and_no_slot_held() {
        let sources = Sources::new(1);
        let err = sources
            .download("http://127.0.0.1:1/missing.step", "step", None)
            .await
            .err()
            .unwrap();
        assert_eq!(err.code, "READ_FAILED");
        assert_eq!(sources.slots.available_permits(), 1);
    }
}
