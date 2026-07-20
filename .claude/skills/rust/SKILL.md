---
name: rust
description: Rust reference for Carbon's cargo workspace (crates/* + apps/assembler) — tokio discipline for CPU-heavy C++ FFI, ownership/interior-mutability choices, rayon isolation, error conventions, performance and profiling, all grounded in measured results from this codebase. Use when writing or reviewing Rust in this repo, deciding spawn_blocking vs inline vs rayon, picking Mutex/RwLock/DashMap/OnceLock/atomics, or hunting allocations. Do not use for the assembler's HTTP/service contract or deployment — that is apps/assembler/AGENTS.md.
---

# rust — how Carbon writes Rust (tokio + heavy C++ FFI)

The workspace: `crates/{occt-bridge,collision,converter,planner}` (cxx bridges
to OpenCASCADE + FCL, geometry, motion planning) and `apps/assembler` (axum
service). The defining constraint: **CPU-bound, non-yielding C++ behind async
HTTP** — most rules below exist because of it. Several are measured facts from
this repo, not folklore.

## Async/tokio discipline — the rules that carry this service

1. **Sync C++/CPU work never runs on an async worker.** Tokio's ~cores worker
   threads poll every socket; a non-awaiting FFI call pins one for its full
   duration. Measured here: running convert inline at c=64 took `/health` p99
   from 7ms to 296ms — one full convert of starvation; real files block minutes.
   Default: `tokio::task::spawn_blocking(move || ffi_work()).await`.
   (`block_in_place` only when you must keep borrowing `!Send` locals; never on
   a current-thread runtime.)
2. **The blocking pool is the queue.** Cap it near core count
   (`Builder::new_multi_thread().max_blocking_threads(n)`) and excess
   `spawn_blocking` tasks queue inside tokio — graceful backpressure with zero
   429/queue code. `apps/assembler/src/main.rs` does exactly this; keep +2
   headroom so `tokio::fs` ops don't starve behind long converts.
3. **Never hold a lock across `.await`.** House pattern: do all locking inside
   sync/blocking scopes (`apps/assembler/src/cache.rs` — LRU behind
   `std::sync::Mutex`, lock held for map ops only, never crosses an await).
   Prefer `std::sync::Mutex` for short non-await sections (faster);
   `tokio::sync::Mutex` only when a guard genuinely must cross an await —
   restructure first.
4. **rayon stays off the tokio runtime.** The planner's `par_iter` sweeps run
   inside `spawn_blocking` closures. Never `.par_iter()` in an `async fn`.
   Remember rayon's pool is process-global: per-request fan-out multiplied by
   concurrent requests oversubscribes — measured here, N single-threaded
   requests across N cores beat N×all-core fan-outs under load
   (`ASSEMBLER_MESH_PARALLEL=0` exists for the same reason on the C++ side).
5. **Timeout ≠ cancellation for blocking work.** `tokio::time::timeout` stops
   the *await*, not the FFI already running on the blocking pool. Bound the
   work itself (early-stop callbacks — see the planner's FCL `canStop()`
   threshold nodes) or accept run-to-completion.
6. Channels: `oneshot` to bridge a blocking/rayon result to a handler,
   `mpsc::channel(n)` for bounded many→one, `watch` for latest-value config,
   `broadcast` for shutdown fan-out. Bound all fan-out
   (`buffer_unordered(limit)`, `Semaphore`) — never unbounded `spawn` loops.
7. Shutdown: prefer awaiting completion (`axum`'s
   `.with_graceful_shutdown(...)`, `JoinSet::join_next()`) over
   cancel-then-sleep — a fixed sleep is fake-graceful.

## Ownership & shared state — decision table

| Need | Use | In-repo example |
|---|---|---|
| Share read-mostly across tasks | `Arc<T>` | `AppState` fields |
| Concurrent map, sharded locks | `DashMap` | plan job store, progress store |
| Byte-bounded LRU | `Mutex<LruCache>` (ns-held, sync scopes only) | `cache.rs` |
| One-time global init | `OnceLock` / `std::sync::Once` | shared `reqwest::Client`; C++ `std::call_once` for OCCT init |
| Counters / phase flags | atomics (`AtomicU64`, `AtomicU8`, relaxed) | `progress.rs` |
| Lazy memo inside a struct | `OnceCell`/`OnceLock` field | `Component::vol_cache`, `sym_axis_cache` |
| Zero-copy payload sharing | `bytes::Bytes` (clone = refcount) | cached GLB/graph uploads |

Signatures take `&str`/`&[T]`; clone only for ownership transfer. `_else`
variants (`unwrap_or_else`, `ok_or_else`) when the eager argument allocates.

## FFI (cxx) — the sharp edges

- Bridges live in `crates/occt-bridge` (OCCT) and `crates/collision` (FCL),
  via the `cxx` crate; C++ exceptions map to `Result` at the bridge.
- **C++ types are `!Send`/`!Sync` by default.** Keep handles thread-confined
  inside one `spawn_blocking` closure; move plain data (Vec/f64) out. When a
  wrapper genuinely is shareable, `unsafe impl Send/Sync` **with the
  justification in a comment** — in-repo precedent: `SharedBvh` and
  `CollisionWorld` (immutable after construction, so concurrent reads are
  sound). No justification comment = review reject.
- Global C++ state is real: OCCT config must be initialized **once**
  (`std::call_once` in `occt.cc`) — per-call mutation of process-global state
  was this repo's original concurrency bug.
- `// SAFETY:` comment on every `unsafe` block, no exceptions.
- Don't set `panic = "abort"` without checking the C++ exception/unwind story
  at the cxx boundary first.

## Errors — the house convention (verified, not aspirational)

Carbon does **not** use thiserror/anyhow. Errors are hand-rolled structs
mirroring the wire contract: `ConvertError { code, message }`
(`crates/converter`), `ApiError { status, code, message }` (`apps/assembler`),
with `From` impls at the boundary. Follow that for service-contract errors.
thiserror is fine for a *new* library crate with no wire contract; never leak
`anyhow` from a library. `?` over match chains; no `unwrap`/`expect` outside
tests and provably-infallible spots.

## Performance — measured habits

- **Measure, don't guess; always `--release`.** This repo's profiling loop:
  macOS `sample <pid>` (worked where samply left hex frames), phase-timing via
  env-gated `eprintln!` (`OCCT_PROFILE=1`), `cargo build --profile profiling`
  (release + debug symbols, defined in the workspace `Cargo.toml`) for
  symbolicated native stacks.
- Contention shows up as *user time*, not lock waits: zero `ulock`/`sys` with
  bad thread scaling = cache-line/allocator trouble. Discriminate software vs
  hardware with the multi-process control (N processes vs N threads of the
  same work — this exposed the OCCT allocator true-sharing bug).
- Allocation hygiene: `with_capacity` when size is known; no intermediate
  `.collect()` (pass `impl Iterator`); `SmallVec` only where measured (the
  contacts type here — kept, measured as noise); memoize expensive derived
  values in `OnceCell` fields rather than recomputing per iteration.
- Allocator: `tikv-jemallocator` is **Linux-only** in `apps/assembler` —
  measured a ~6% *loss* on macOS. Don't "fix" that gate.
- `#[inline]`, LTO, `codegen-units=1`: only with a benchmark proving them.

## Tooling

- `cargo build --release -p assembler` — workspace root; build.rs resolves
  OCCT via `OCCT_PREFIX` → cached static build (`~/.cache/carbon-occt/`) →
  brew (see `apps/assembler/AGENTS.md`).
- Tests: unit in-module; integration in `crates/*/tests/` — behavioral
  synthetic-geometry tests (`crates/planner/tests/synthetic_plan.rs`) are the
  model: build inputs in code, assert invariants, no fixtures/goldens.
  Env-gated tests (`ASSEMBLER_FIXTURES`, `ASSEMBLER_ASSEMBLIES`) skip silently
  when unset — fine for corpus tests, never for core logic.
- `cargo clippy --all-targets -- -D warnings` before committing Rust;
  `#[expect(lint, reason = "...")]` over blanket `#[allow]`.
