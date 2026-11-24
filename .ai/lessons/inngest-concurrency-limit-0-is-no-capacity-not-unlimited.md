---
paths: ["packages/checks/src/conformance/no-zero-concurrency.ts"]
triggers: ["concurrency:"]
promoted: null
---
# Inngest `concurrency: { limit: 0 }` is no capacity, not unlimited

**Context:** Moving webhooks onto the event system. The `WEBHOOK` handler had never actually run — webhooks went through 39 pg_net triggers, so the handler was dead code. Once a subscription made it live, every delivery sat in `QUEUED` forever and nothing reached the endpoint.

**Problem:** `webhook.ts` declared `concurrency: { limit: 0, key: "<table>-<recordId>" }`. `limit: 0` reads like "unlimited" and is almost certainly what the author meant, but Inngest treats it as zero capacity: runs are accepted, grouped by key, and never scheduled. The failure is silent and looks like the event never fired — the drainer completes, the queue empties, `pgmq` shows nothing pending, and only the run list reveals runs parked in `QUEUED` while sibling handlers from the same drain show `COMPLETED`. A controlled test confirmed it: three runs stuck at `limit: 0`, and changing only that value to `1` released them. Two more instances existed — `workflow.ts` (a stub, latent) and `reschedule-job.ts` (`schedule-job`, live, called from `production.server.ts` and `production.service.ts`).

**Rule:** Inngest `concurrency.limit` must be `>= 1`; to mean "unlimited", omit the `concurrency` block entirely. With a `key`, `limit: 1` is the usual intent — serialize per record/company. Enforced by the `no-zero-concurrency` conformance check in `@carbon/checks`. More generally: a handler with zero subscriptions is dead code whose config is never exercised, so any bug in it surfaces only when something makes it live — when wiring an existing-but-unused handler, fire it end-to-end rather than trusting that it worked before.

**Applies to:** `packages/jobs/src/inngest/**` `createFunction` options; `packages/checks/src/conformance/no-zero-concurrency.ts`.
