---
paths: []
triggers: []
promoted: null
---
# A live sandbox pass finds what unit tests cannot: the wire contract

**Context:** The Ramp Part C run (2026-09-10) on a fresh worktree DB against the demo sandbox, after Parts A/B were unit-tested and typecheck-clean.

**Problem:** Three things only the real API surfaced: (1) the batch account push sent a new Carbon-side `visible` flag inside the POST items → Ramp 422 "Unknown field" failed the whole chart push; (2) every sync confirm had been failing for weeks — `successful_syncs`/`failed_syncs` have `minItems: 1` (an empty `[]` is a 422) and a failed item is `{ id, error: { message } }` — and the failure was only `console.error`'d, so Ramp kept every synced transaction `SYNC_READY`; (3) `ensureRampConnection` only creates, so a fresh DB against a business that already has a Carbon connection cannot install.

**Rule:** Keep wire payloads behind pure, exported builders (`toRampGlAccountPayload`, `buildSyncConfirmBody`) with tests pinning the exact shape, never spread an internal object onto a request; put every caught provider error on the Inngest step OUTPUT (`error` / `confirmError`), not just the console — the run record is the only thing an operator can read; and when a verification note says "pushed", check the provider's own status field (`sync_status`, `synced_at`) rather than the HTTP code.

**Applies to:** every Ramp push/confirm, the accounting providers' adapters, and any integration verified only by "the request returned 2xx".
