---
name: debugging-difficult-bugs
description: Runtime-instrumentation debugging for bugs that static reading can't pin down — add temporary unconditional JSONL logging to the real code path, reproduce, read the log, then fix. Use when /root-cause lands at MEDIUM/LOW confidence, when a bug involves runtime state, ordering, caching, streaming, concurrency, or manual/UI reproduction, or before a second speculative fix. Skip when a stack trace or a deterministic failing test already proves the cause.
---

# debugging-difficult-bugs — instrument, reproduce, read, then fix

Core idea: when you can't see the failure by reading code, **make the runtime
tell you**. Add temporary append-only JSONL logging along the real code path,
reproduce the real issue once, read the log chronologically, and only then fix.
Never make a second speculative fix without new runtime evidence.

**Announce at start:** "Using the debugging-difficult-bugs skill — instrumenting
the runtime path to observe the failure."

## Step 1: State the uncertainty

Write down: what you believe, what you can't verify statically, and the exact
runtime path that must be observed (route → service → query, edge function, job).

## Step 2: Add temporary unconditional instrumentation

Rules:

- **Unconditional** — never gated behind an env var, debug flag, or log level.
  If reproduction requires remembering to set a flag, it will silently not fire.
- **Append-only JSONL**, one JSON object per line, to a file in the process's
  working directory.
- Log **boundaries and decisions**, not every line: function entry/exit, branch
  decisions with the data that caused them, state before/after mutation, async
  ordering markers, caught errors, return-value shapes.
- Log **shapes, not payloads**: ids, keys, counts, statuses. Never log tokens,
  auth headers, cookies, or full user content.

```ts
import { appendFileSync } from "node:fs";
import { join } from "node:path";

function debugBug(event: string, data: Record<string, unknown> = {}) {
  appendFileSync(
    join(process.cwd(), "debug-difficult-bug.jsonl"),
    `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`
  );
}

debugBug("service.beforeUpdate", { id, companyId, status: row.status });
```

**Carbon multi-process note.** The ERP/MES dev servers, edge functions (Docker
`edge-runtime` container), and Inngest handlers run as separate processes with
different working directories. Log `process.cwd()` + a process role once at
startup, or use distinct filenames (`debug-erp.jsonl`, `debug-edge.jsonl`). For
edge functions, `console.error` JSON lines (visible in container logs) can stand
in when the container filesystem is awkward to reach.

## Step 3: Reproduce the real issue once

- Prefer reproducing yourself: boot the stack (`crbn up` if not already
  running), authenticate with `/auth`, and drive the exact failing flow with
  `agent-browser` (the `/test` skill documents Carbon's form gotchas —
  `requestSubmit`, react-aria blur).
- If only the user can reproduce (their data, their environment), tell them
  exactly: "I added temporary logging. Reproduce the issue once, then point me
  at `<cwd>/debug-difficult-bug.jsonl`."

## Step 4: Read the log BEFORE fixing

Read chronologically and answer, in writing:

1. Did the instrumented path actually run?
2. What was the expected sequence of events?
3. What was the actual sequence?
4. What is the **first** point where state/order/branch diverges from expectation?

That first divergence is the root cause candidate. Feed it back into the
root-cause brief (or write one now) — then implement via `/fix`, whose failing
regression test must assert the *actual* divergence you observed, not your
earlier assumption.

## Step 5: Clean up — mandatory

- Remove every temporary log call, helper, and import.
- Delete generated `.jsonl` files.
- Check the final diff explicitly for leftovers:
  `git diff | grep -n "debugBug\|debug-difficult\|\.jsonl"` → expect no hits.

The final diff contains only the fix and its tests.

## Done when

- [ ] The first divergence point is identified from log evidence (quote the lines)
- [ ] The fix landed via `/fix` with a red→green regression test asserting that behavior
- [ ] Reproduction of the original flow now passes
- [ ] Zero instrumentation remnants in the diff
