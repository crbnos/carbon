# Inngest verification for a self-chaining scheduler (Phase 6)

Verified 2026-07-31 against current official Inngest docs, the `inngest/website` docs
source, the open-source `inngest/inngest` executor (ground truth for undocumented edges),
and the SDK actually installed in this repo.

**Repo SDK version:** `inngest@3.54.0` (single resolved version — see §8).

---

## 1. `step.sleepUntil(id, date)`

**Signature** — [docs/reference/functions/step-sleep-until](https://www.inngest.com/docs/reference/functions/step-sleep-until),
[v3 reference](https://www.inngest.com/docs/reference/typescript/functions/step-sleep-until):

```ts
step.sleepUntil(id: string, datetime: Date | string | Temporal.Instant | Temporal.ZonedDateTime): Promise<void>
```

- `id` — "The ID of the step. This will be what appears in your function's logs and is
  used to memoize step state across function versions."
- `datetime` — `Date`, ISO 8601 string (`YYYY-MM-DDTHH:mm:ss.sssZ`), or Temporal object.
- "`step.sleepUntil()` must be called using `await` or some other Promise handler to
  ensure your function sleeps correctly."
- Installed 3.54.0 type confirms the same union:
  `sleepUntil: (idOrOptions: StepOptionsOrId, time: Date | string | InstantLike | ZonedDateTimeLike) => Promise<void>`
  (`node_modules/inngest/components/InngestStepTools.d.ts:225`). `StepOptionsOrId` means
  you may pass `"my-id"` or `{ id, name }`.

**Maximum duration — yes, one year (366 days server-side).**

- [Sleeps guide](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/sleeps):
  "Your function can sleep for seconds, minutes, or days, **up to a maximum of one year**."
- [Usage limits](https://www.inngest.com/docs/usage-limits/inngest): "Inngest supports
  sleeps up to one year" … "**Free plan sleeps are limited to up to seven days.**"
- Executor const: `MaxSleepDuration = time.Hour * 24 * 366`
  (`pkg/consts/consts.go`, github.com/inngest/inngest).
- Over the cap is a hard error, not a clamp — `boundedSleepDuration` returns
  `ErrTimeoutTooLong`: *"The sleep %q ends more than one year in the future; sleeps may
  last at most one year."* (`pkg/execution/state/opcode.go`).

**Past date — resolves to a zero-duration sleep; the run continues (effectively) immediately.**
This is **not documented on the docs site**; it is unambiguous in the OSS executor
(`pkg/execution/state/opcode.go`, `GeneratorOpcode.SleepDuration`):

```go
if parsed, err := dateutil.Parse(opts.Duration); err == nil {
    at := time.Until(parsed).Round(time.Second)
    if at < 0 {
        return time.Duration(0), nil   // past date -> no wait
    }
    return boundedSleepDuration(at, opts.Duration)
}
```

Caveats for a scheduler design:
- It does **not** throw and does **not** skip — it still consumes one step and one
  re-enqueue round-trip. A tight self-chain that computes an already-past `nextRunAt`
  will spin at full speed and burn the 1000-step budget. Guard the computed next-fire
  time (`max(nextRunAt, now + minInterval)`) yourself.
- Note the `Round(time.Second)` — sub-second precision is not preserved.
- An **invalid** (unparseable) date throws client-side in the SDK before reaching the
  server: `Invalid \`Date\`, date string, ... passed to sleepUntil: ${time}`
  (`InngestStepTools.js:243`).

## 2. Dynamic per-tenant cron registration — NOT supported

Cron triggers are **static, declared in code, and registered at deploy/sync time**.

- [Scheduled functions guide](https://www.inngest.com/docs/guides/scheduled-functions):
  cron schedules are "defined in code" inside `createFunction()`. Every example is a
  literal string in the function definition. There is no runtime registration API in the
  SDK or the REST API.
- **Feature request closed as "not planned":**
  [inngest/inngest#3012 — "Support dynamic cron expression when invoke function"](https://github.com/inngest/inngest/issues/3012)
  (state: **closed as not planned**; internal ticket INN-5440). The requester asked for
  `inngest.send({ name, data, cron: "*/3 * * * *" })` / a `repeat: { every, times }`
  option, citing Temporal's schedule API.
  Maintainer `djfarrelly` (Inngest) replied, verbatim:
  > "Hi @liho00 - I'd love to learn a bit more about the use case to help share how I'd
  > think we could incorporate similar logic in Inngest. Would the cron be updated by a
  > user? … I don't know if this helps you immediately, but we do enable you to schedule
  > one-off functions using the `ts` field in `inngest.send()`. You can also batch events
  > as well by sending many event payloads to `inngest.send`, but that may suit your use
  > case. Here's the doc for how to use `ts`:
  > https://www.inngest.com/docs/examples/scheduling-one-off-function"

  i.e. the sanctioned answers are (a) `ts` on `inngest.send()` for one-off future runs and
  (b) `step.sleepUntil` self-chaining — exactly the design we are proposing. There is no
  first-class dynamic-schedule primitive and none is planned.
- Corroborating: [delayed functions](https://www.inngest.com/docs/guides/delayed-functions)
  — "When you set the `ts` field on an event to a future Unix timestamp, Inngest delays
  invoking the function until that time"; "Delays can be up to a year (up to seven days on
  the free plan)."

**Design consequence:** per-tenant schedules must live in our own DB. Either one static
low-frequency dispatcher cron that fans out, or a self-chaining `sleepUntil` run per
schedule. Both are supported patterns; neither is a registered cron.

## 3. Cron syntax and timezones — supported

[Scheduled functions guide](https://www.inngest.com/docs/guides/scheduled-functions):

- Standard 5-field cron: `minute hour day-of-month month day-of-week`.
- Timezone prefix **is** supported: `TZ=<IANA zone> <expr>`, e.g.
  `{ cron: "TZ=Europe/Paris 0 12 * * 5" }`. So `TZ=America/New_York 0 9 * * *` is valid.
  "Inngest's cron schedules also support timezones, allowing you to schedule work in
  whatever timezone you need work to run in."
- **DST warning (verbatim):** "Inngest's cron behavior follows the underlying cron library
  and does not apply special DST correction. To reduce risk, avoid transition-hour
  schedules (such as `2:00 AM` in many US regions, or `12:00 AM` in some other regions),
  and prefer `TZ=UTC` when you need consistent execution timing." Near a DST transition a
  schedule may fire zero, one, or two times.
- `jitter` is supported on a cron trigger (`{ cron: "0 * * * *", jitter: "5m" }`);
  "Jitter must be between 1 second and 5 minutes."
- Free plan: "if your function fails 20 times consecutively it will automatically be paused."
- Multiple triggers per function are allowed, including mixing cron and events:
  [multiple triggers](https://www.inngest.com/docs/guides/multiple-triggers) — "Functions
  support up to **10 unique triggers**"; disambiguate with `event.name`.
- Minimum granularity is one minute (implied by 5-field cron; not stated as an explicit
  numeric limit in the docs). Sub-minute scheduling requires sleeps, not cron.

**Relevant to us:** since our per-tenant schedules are user-defined with user timezones,
the cron `TZ=` support is irrelevant to per-tenant scheduling — we compute next-fire times
ourselves (e.g. with a TZ-aware library) and feed `sleepUntil` an absolute instant.

## 4. `concurrency` with `limit: 1` — queues, never drops

[Concurrency guide](https://www.inngest.com/docs/guides/concurrency):

- "When concurrency limit is reached, **new steps will continue to be queued** and create a
  backlog to be processed." Nothing is dropped or lost.
- "Queues are ordered from oldest to newest jobs (FIFO)" within a function.
- `limit: 1` + a `key` expression = one executing step at a time **per unique key value**:
  "creates a **virtual queue** for every unique value and limits concurrency to each."
  Different key values still run in parallel.
- `scope`: `fn` (default, that function only), `env` (shared across functions in the env
  using the same key), `account` (shared across all envs/functions).
- **Sleeping does not consume a slot (verbatim):** "Calling `step.sleep`,
  `step.sleepUntil`, `step.waitForEvent`, or `step.invoke` does not count towards capacity
  limits, as the SDK doesn't execute code while those steps wait." Only `step.run()`
  counts, while its code is executing.
- Note: concurrency does **not** deduplicate. If you need "only one live run per schedule",
  use `singleton` (see §6) or event-`id` dedupe (see §5) — `concurrency: { limit: 1 }`
  just serializes; the backlog still runs eventually.

## 5. Event `id` idempotency — 24-hour dedupe window, global across event types

[Events docs](https://www.inngest.com/docs/events):

- "Once Inngest receives an event with an `id`, any events sent with the same `id` will be
  **ignored, regardless of the event's payload**."
- "Deduplication prevents duplicate function runs for **24 hours** from the first event."
- "The `id` is **global across all event types**, so make sure your `id` isn't a value that
  will be shared across different event types." Docs recommend namespacing, e.g.
  `item-imported-9f08sdh84` rather than the bare record id.

**Design consequence:** an id like `schedule-tick-${scheduleId}-${nextRunAtISO}` gives
exactly-once chaining for ticks less than 24h apart. For intervals **longer than 24h** the
dedupe window has expired, so the event id alone will not protect against a duplicate
chain — pair it with a DB guard (a `nextRunAt`/`chainToken` compare-and-set) or `singleton`.

## 6. Limits relevant to a long-lived self-chaining function

Sources: [usage limits](https://www.inngest.com/docs/usage-limits/inngest),
[sleeps](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/sleeps),
and `pkg/consts/consts.go` in `inngest/inngest`.

| Limit | Value | Source |
|---|---|---|
| Max function run duration | Free 30 days · Basic 90 days · **Pro 366 days** · Enterprise custom | usage-limits |
| Max steps per run | **1000** (`DefaultMaxStepLimit`; executor hard ceiling `AbsoluteMaxStepLimit = 10_000`) | usage-limits + consts.go |
| Max sleep / waitForEvent | 1 year (`MaxSleepDuration = MaxWaitForEventTimeout = 366 days`); free plan 7 days | usage-limits + consts.go |
| Max single step/function execution time | **2 hours** (`MaxFunctionTimeout`) — this is per HTTP execution, not per run | consts.go |
| Function run state size | 32MB (`DefaultMaxStateSizeLimit`) — event data + all step outputs + metadata | usage-limits + consts.go |
| Event payload size | Free 256KiB · Basic 512KiB · Pro 3MiB | usage-limits |
| Concurrent steps (account) | Free 5 · Basic 25 · Pro 200+ | usage-limits |
| Sleeping counts against concurrency? | **No** — "A Function paused by a sleeping Step doesn't affect your account capacity; i.e. it does not count against your plan's concurrency limit" and "doesn't count against any concurrency policy you've set on the function, either" | sleeps guide + concurrency guide |

Additional operational notes:

- Step limit is the binding constraint on an infinite self-chain. At ~2 steps per tick
  (`sleepUntil` + a `step.run`), a single run tops out around 300–500 ticks. The chain must
  **re-emit an event and end the run** periodically (or per tick) rather than loop forever
  inside one run. The 1000-step ceiling is a documented failure, not a soft warning:
  exceeding it fails the run with guidance to fan out instead of looping.
- Docs caveat on long sleeps: "function runs using sleeps longer than your plan's trace and
  log history limit may not appear in the Inngest Cloud dashboard, though the functions
  continue sleeping as expected. You can still verify their status using Quick Search or the
  REST API." Trace history is 24h on Free up to 90 days on Enterprise — so a 30-day sleeping
  run can go invisible in the UI. Plan our own observability (DB `nextRunAt` column).
- Long-sleeping runs survive deploys, but the step ids must stay stable — step memoization
  is keyed on the step `id`, so do not derive `sleepUntil` ids from mutable values.
- `singleton: { key, mode: "skip" | "cancel" }` is available and is the cleanest guard
  against duplicate chains per schedule ([singleton guide](https://www.inngest.com/docs/guides/singleton)):
  "skip" skips the new run if one is already executing; "cancel" cancels the existing run
  and starts the new one. Confirmed present in the installed 3.54.0 types
  (`components/InngestFunction.d.ts:312`) and already used in this repo
  (`packages/jobs/src/inngest/functions/tasks/model-optimize.ts`). The docs do not state
  whether a *sleeping* run holds the singleton lock — treat that as unverified and confirm
  empirically before relying on it.

## 7. `step.sendEvent` vs `inngest.send` inside a function

Use **`step.sendEvent`** inside a function.
[step.sendEvent reference](https://www.inngest.com/docs/reference/functions/step-send-event):

- "Use this instead of `inngest.send()` to ensure **reliable event delivery** from within
  functions."
- "To send events from outside of the context of a function, use `inngest.send()`."
- "`step.sendEvent()` must be called using `await` or some other Promise handler to ensure
  your function sleeps correctly."

Why it matters for a self-chain: `step.sendEvent` is a memoized durable step, so on a retry
of a later step the chaining event is **not** re-sent. A bare `inngest.send()` inside a
function is un-memoized — every retry of the surrounding execution re-sends it, which for a
self-chaining scheduler means forked/duplicated chains. Installed 3.54.0 signature:
`sendEvent(idOrOptions, payload)` where payload is one event or an array
(`components/InngestStepTools.d.ts:114`).

## 8. This repo's Inngest version

Declared:

- `packages/lib/package.json:12` → `"inngest": "3.54.0"` (pinned)
- `packages/jobs/package.json:26` → `"inngest": "^3.52.7"`
- `apps/erp/package.json:83` → `"inngest": "^3.52.7"`

Installed: **`inngest@3.54.0` only** — both pnpm store entries resolve to 3.54.0, so there
is no version skew across packages.

**Does anything above differ for 3.54.0?** No material differences. Checked against the
installed `.d.ts`/`.js`:

- `sleepUntil` already accepts `Date | string | Temporal.Instant-like | Temporal.ZonedDateTime-like`
  — matches the current (v4-era) docs page, so the newer docs are safe to follow here.
- `singleton` (`key` + `mode`) is present in 3.54.0 — not a v4-only feature.
- `concurrency` (array form, `key`, `scope`, `limit`) and multi-`triggers` arrays are present.
- `step.sendEvent(idOrOptions, payload)` signature is unchanged.
- The sleep/step/state limits in §6 are **server-side** (Inngest Cloud executor), not SDK
  version dependent.
- One doc-vs-SDK note: the docs reference pages linked above are the current v4 pages. The
  v3 page (`/docs/reference/typescript/functions/step-sleep-until`) documents the identical
  signature, so no divergence for our usage.

### How Carbon uses Inngest today (context for the design)

- All existing crons are **static and UTC** (no `TZ=` prefix), e.g.
  `packages/jobs/src/inngest/functions/scheduled/mrp.ts` (`0 */3 * * *`),
  `.../notification-digest.ts` (`*/15 * * * *`), `.../audit-archive.ts` (`0 2 * * *`),
  `.../cleanup.ts`, `.../dispatch.ts`, `.../weekly.ts`, `.../update-exchange-rates.ts`,
  `.../notification-purge.ts`, `.../integrations/timecard-auto-close.ts`.
- Per-tenant serialization via concurrency keys is already the house pattern:
  `concurrency: { key: "event.data.companyId", limit: 1 }` in
  `packages/jobs/src/inngest/functions/tasks/company-import.ts:39` and
  `.../company-export.ts:294`.
- The workflows engine already uses `concurrency` arrays and `step.sendEvent`
  (`packages/jobs/src/inngest/functions/workflows/run.ts:29`,
  `.../workflows/moment.ts:55`).

---

## Bottom line for the Phase 6 design

1. Dynamic per-tenant cron is impossible in Inngest and explicitly not planned (#3012) —
   the DB owns schedules; Inngest owns timing.
2. `sleepUntil` up to 366 days is real and free of concurrency cost, so a self-chaining
   run per schedule is viable.
3. The 1000-step ceiling forces **one tick per run** (re-emit + end the run), not a loop.
4. Past dates silently become zero-duration sleeps — clamp `nextRunAt` to
   `now + minInterval` or the chain will spin.
5. Guard against duplicate chains with `singleton { mode: "skip" }` plus a DB
   compare-and-set; event-`id` dedupe only covers a 24-hour window.
6. Always chain with `step.sendEvent`, never a bare `inngest.send`.
