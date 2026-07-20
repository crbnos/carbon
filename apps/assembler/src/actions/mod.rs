//! Per-action compute tasks. Each `spawn` runs the action in a Tokio task that
//! holds a concurrency slot and drives the shared `JobStore` lifecycle
//! (running → uploading/done/error). The HTTP layer (`main.rs`) only parses the
//! request and calls `spawn`; all compute + storage I/O lives here.

pub mod compact;
pub mod convert;
pub mod optimize;
pub mod plan;
