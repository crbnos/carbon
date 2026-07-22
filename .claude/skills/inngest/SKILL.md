---
name: inngest
description: Inngest platform reference for Carbon's background jobs — durable functions, steps, events, flow control, error handling, and local dev, all in the v3 syntax Carbon actually runs (inngest ^3.52 in @carbon/jobs). Use when writing or reviewing Inngest functions, choosing flow-control (concurrency/throttle/rateLimit/debounce/singleton/batch), wiring waitForEvent/sendEvent/invoke, or debugging retries and duplicate work. Do not use for Carbon's DB-event wiring (PGMQ triggers, handler tables) — that is .claude/rules/event-system.md; and do not copy v4 syntax from the internet, see the v3/v4 table here first.
---

# inngest — platform reference (v3, as Carbon runs it)

Distilled from Inngest's official skill set, corrected to the **v3 API Carbon
uses** (`inngest@^3.52.7` in `packages/jobs`, `3.54.0` in `packages/lib`; the
client is `packages/lib/src/inngest/client.ts`). Repo wiring (where functions
live, registration, PGMQ event system) is in `packages/jobs/AGENTS.md` and
`.claude/rules/event-system.md` — this skill is the platform semantics.

## The one mental model that prevents most bugs

Each `step.run` is a separate HTTP invocation. The handler **re-runs from the
top on every step**; completed steps return memoized results instead of
re-executing. Therefore ALL non-determinism — API/DB calls, `Date.now()`,
`Math.random()`, UUIDs, logging you don't want duplicated — must live **inside**
a step. Code outside steps executes again on every invocation.

## v3 vs v4 — Carbon is v3; most internet examples are v4

| Concept | v3 (Carbon — USE THIS) | v4 (do NOT copy) |
|---|---|---|
| Function shape | `createFunction({ id, ... }, { event: "x" }, handler)` — trigger is the 2nd positional arg | `triggers: [...]` inside the first arg |
| Multiple triggers | supported — pass an array as the 2nd positional arg: `createFunction(opts, [{event: "x"}, {cron: "..."}], handler)` (verified in inngest@3.54 types: `SingleOrArray<InngestFunction.Trigger>`) | `triggers: [{event}, {cron}]` inside the first arg |
| Event typing | `EventSchemas` + the `Events` type in `packages/lib/src/events.ts` | `eventType()` / `staticSchema<T>()` |
| Testing | no `@inngest/test` (needs v4) — test handlers as plain functions with mocked services | `InngestTestEngine` |
| Local dev mode | v3 defaults to dev mode locally | v4 defaults to Cloud; needs `INNGEST_DEV=1` |
| Not in v3 | — | `step.ai`, `step.waitForSignal`, checkpointing, native realtime, `group.parallel()` |

## Function config (all keys go in the first argument)

```typescript
inngest.createFunction(
  {
    id: "assembly-convert",            // permanent; changing it = new function
    retries: 2,                        // per-STEP retries (2 retries = 3 attempts)
    concurrency: [{ limit: 4 }, { key: "event.data.companyId", limit: 2 }],
    onFailure: async ({ event, error }) => { /* after ALL retries exhausted */ },
  },
  { event: "carbon/assembly-convert" }, // or { cron: "*/2 * * * *" } or { event, if: "<CEL>" }
  async ({ event, step, logger, attempt }) => { /* ... */ }
);
```

Other config keys, all optional: `idempotency: "event.data.cartId"` (one run
per key per 24h), `cancelOn: [{ event, if }]`, `timeouts: { start, finish }`,
and the flow-control table below. Real examples:
`packages/jobs/src/inngest/functions/tasks/*.ts`.

## Steps

| Method | Signature | Semantics |
|---|---|---|
| run | `step.run(id, fn)` | Retriable unit; result persisted. IDs reusable in loops (auto-indexed). Renaming an ID after deploy forces re-execution. |
| sleep | `step.sleep(id, "24h")` / `step.sleepUntil(id, date)` | Durable delay, zero compute while sleeping. |
| waitForEvent | `step.waitForEvent(id, { event, timeout, match \| if })` | Pauses for a matching event. **Returns `null` on timeout — always check.** Only catches events sent AFTER the wait starts. |
| sendEvent | `step.sendEvent(id, payload \| payload[])` | Fan-out / trigger others. Prefer over `inngest.send()` inside functions. |
| invoke | `step.invoke(id, { function, data })` | Call another function, await its typed result. |

- **CEL convention** (`waitForEvent.if`, `cancelOn.if`): `event` = the original
  triggering event, `async` = the incoming event being matched.
  `if: 'event.data.jobId == async.data.jobId'`.
- **Parallel:** create steps unawaited, then `await Promise.all([...])`.
- **Wrap in a step:** anything non-deterministic or independently retriable.
  **Don't wrap:** pure computation, validation, branching — and don't
  over-granularize (each step ≈ one HTTP round trip; step count is the real
  budget, see limits).
- **Limits:** 1000 steps/run, 4MB per step output, 32MB total run state.
  Approaching them → split with `step.invoke` / `step.sendEvent`. (This is why
  Carbon's assembly-plan pipeline is event-driven submit/finalize, not a
  poll loop.)

## Events

- Payload: `{ name, data, id?, ts?, v? }`. Send with
  `inngest.send(...)` → `{ ids }`; batch ≤512KB.
- **`id` = 24h dedupe key.** `id: `plan-done-${jobId}`` — one processing per id
  per event name. Make it instance+type specific, never a bare entity id.
- `ts` (Unix ms) in the future = delayed delivery; also fixes ordering in a batch.
- Naming: `domain/noun.verb`, past tense. Carbon's house style is the flatter
  `carbon/<task-name>` — follow the codebase, and register the type in the
  `Events` type (`packages/lib/src/events.ts`) so functions are typed.
- Fan-out: N functions may trigger on one event; they run/fail/replay
  independently.
- System events you can subscribe to: `inngest/function.failed` (data has
  `function_id`, `run_id`, `error`), `inngest/function.finished`,
  `inngest/function.cancelled`.

## Flow control — pick by what happens to excess work

| Mechanism | Limits | Excess events are… | Shape |
|---|---|---|---|
| `concurrency` | active step execution (waiting/sleeping runs don't count) | queued | `5` or `[{ key: "event.data.companyId", limit: 2 }]` |
| `throttle` | run starts over time | **delayed** | `{ limit, period: "60s", burst?, key? }` |
| `rateLimit` | run starts, hard cap | **dropped** | `{ limit, period: "4h", key? }` |
| `debounce` | one run after events stop | superseded — **last wins** | `{ period: "5m", key?, timeout? }` |
| `singleton` | one run per key | `mode:"skip"` drops new / `mode:"cancel"` kills old | `{ key, mode }` |
| `priority` | queue order | — | `{ run: "event.data.tier=='vip' ? 120 : 0" }` (seconds ahead) |
| `batchEvents` | groups events into one run | batched; handler gets `{ events }` | `{ maxSize: 100, timeout: "30s", key? }` |

Memorize: **throttle delays, rateLimit drops, debounce keeps-last;
concurrency caps execution, throttle caps starts.** Combine mechanisms (e.g.
Carbon's assembly jobs: global + per-company concurrency).

## Error handling

- A thrown error retries **that step** (exponential backoff + jitter,
  independent per step). `retries: N` = N+1 attempts.
- `throw new NonRetriableError("msg")` (`import { NonRetriableError } from
  "inngest"`) — permanent failures: validation, not-found, auth, "the service
  is down and retrying just holds rows in Processing" (see the fail-fast
  pattern in `assembly-convert.ts`).
- `throw new RetryAfterError("msg", "30s" | date)` — honor upstream 429/503
  backoff.
- A step that exhausts retries throws into the handler — `try/catch` it to run
  fallback steps; uncaught, the function fails → `onFailure` runs and
  `inngest/function.failed` is emitted.

## Local dev

- Dev server runs in the Carbon stack (`crbn up`; `INNGEST_BASE_URL` in
  `.env.local`, UI at that port). Standalone: `npx inngest-cli@latest dev`.
- Send a test event by hand:
  `curl -X POST $INNGEST_BASE_URL/e/dev -H 'content-type: application/json' -d '{"name":"carbon/x","data":{}}'`
  (any event-key segment works locally).
- Services outside the JS app (e.g. the Rust assembler) push events to the same
  ingest URL — that's `INNGEST_EVENT_KEY`/`INNGEST_EVENT_URL` on the assembler.

## Middleware (only when a concern is truly cross-cutting)

`new Inngest({ middleware: [...] })`. Useful ones: `dependencyInjectionMiddleware`
(inject shared clients into handler ctx), `@inngest/middleware-encryption`,
`@inngest/middleware-sentry`. Custom middleware hook signatures on the internet
are usually the v4 rewrite — verify against installed v3 types before copying.
