# Bugfix run: get-method itemToJob slow on large BOMs

- Date: 2026-08-17
- Mode: fully-autonomous (user directive: "fix only get-method")
- Request: Creating a job for ZA-002-00-000 (Durin Manufacturing) takes ~2.5 min; root cause proven from edge-runtime logs + code. Fix scope limited to the get-method edge function; explicitly excluded: packages/auth fetchWithRetry.
- Phase plan: root-cause [done in-conversation, HIGH] · instrument [skip — cause proven from runtime logs] · fix [run] · test [skip browser — edge function; live timed re-invoke offered to user, blocked on DB-write permission per user rule] · commit [skip — not requested]

## Decisions

- instrument: skip — HIGH confidence, mechanism observed directly in edge-runtime logs (3× stacked get-method invocations at 25s intervals, per-node traversal cadence).
- regression test: no unit-test harness exists for Deno edge functions and the bug is a performance property of a 6,800-line function; red→green proof deferred to a timed live invocation which writes to the dev DB — user's standing rule requires asking before DB mutation, so it is offered, not run.
- scope: itemToJob case only. The itemToJobMakeMethod case (line ~1366) has the same N+1 pattern + debug logs — noted, not fixed.

## Phase log

- root-cause: HIGH. traverseMethod does O(tree) sequential roundtrips: per-node itemReplenishment (line ~604) and methodOperation select (~644); per-material itemReplenishment (~1086) and getStorageUnitId (2 queries, ~1132) — all serialized on the single Kysely transaction connection. For 32 make methods / 44 ops / 259 materials ≈ 600+ roundtrips ≈ 30–60s locally → exceeds the client's 25s per-attempt timeout → fetchWithRetry stacks 3 concurrent delete-and-recreate runs → lock contention + supervisor kills. Debug console.log flooding ([traverseMethod], logTree) adds isolate overhead.
- fix: DONE. In the itemToJob case: (1) collect all tree nodes once after getMethodTree; (2) prefetch itemReplenishment (chunked .in(), 200/chunk, companyId-scoped) and methodOperation+embeds (chunked .in(), 100/chunk) for the whole tree before the transaction; (3) prefetch default storage units (itemLedger grouped aggregate + pickMethod, 2 queries) at transaction start, pickMethod default winning over highest-quantity bin — same precedence as getStorageUnitId; (4) traversal now uses Map lookups: node scrap, per-material scrap (covers supersession-redirected itemIds — targets added to the prefetch set), storage unit; (5) removed [traverseMethod] console.log blocks and the logTree dump. Roundtrips: ~600+ → ~7 fixed queries + inserts. getStorageUnitId import retained (used by other cases at lines ~1833/5002).
- gates: deno check own-file error delta 0→0 (99 pre-existing shared-dep errors unchanged, per lessons.md this is the gate); biome N/A (edge functions outside lint surface, per lessons.md). Unrelated no-op reordering diff in generated types files restored via git checkout.

## Regression + repair (post-fix)

- User created J000006 → empty BOM. Cause: my replenishment prefetch chunked PostgREST `.in()` at 200 UUID ids ≈ 8KB URL → gateway request-line limit → prefetch threw "Failed to get item replenishment"; caller logs and continues, so the job landed with no BOM. Fixed by moving the replenishment read to Kysely `db` (bind params, no URL cap), ops chunk 200→50, error messages now include `res.error.message`. Lesson appended to .ai/lessons.md.
- Repaired + proved: re-invoked get-method itemToJob on J000006 → success in 5.5s (was 25s+ timeouts, never completing); BOM verified 32 jobMakeMethod / 259 jobMaterial / 44 jobOperation. recalculate then run for parity → success.

## Phase 2 (user extended scope): recalculate N+1

- J000007 created by user: get-method now ~4.5s, but recalculate timed out at 25s and retried (logs 14:13:56, 14:14:22). User asked to fix the N+1.
- Rewrote `updateJobQuantities` (recalculate/index.ts): collect tree nodes once; batch-select jobMaterial.itemScrapPercentage + itemReplenishment fallback (2 queries); compute all quantities in memory top-down (identical math); write set-based via `UPDATE … FROM (VALUES …)` for jobMaterial, jobMakeMethod.quantityPerParent, jobOperation target/operation quantities, and trackedEntity (1 batched select + up to 4 statements). ~800 statements → ~7.
- Gates: deno check own-file errors 0→0. Live proof on J000007: 27.5s → **1.086s**, and md5 checksums of (jobMaterial scrap/estimated) and (jobOperation target/operation) are byte-identical before/after — exact behavior parity.

## Outcome

- READY (uncommitted), live-verified end to end: get-method itemToJob ~4.5s (was 3×25s timeout-stacked), recalculate jobRequirements ~1.1s (was 27.5s ×2-3). Job creation for the largest dev BOM should now complete in one attempt, well under the 25s client timeout.
- Known remaining (flagged, not fixed): get-method `itemToJobMakeMethod` case has the same N+1 pattern + [traverseMethod] debug logs; fetchWithRetry retry semantics on non-idempotent invokes (options given to user); recalculate `jobMakeMethodRequirements` case now shares the fixed updateJobQuantities so it benefits too.
