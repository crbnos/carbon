# Jobs and events lessons

Inngest functions, the event queue, crons, notification delivery.

## A background job that reads, works, then writes compares before it writes

```scope
id: a-background-job-that-reads-works-then-writes-compares-befor
paths: ["packages/jobs/src/inngest/functions/tasks/sales-order-delivery-date-check.ts"]
triggers: ["check-sales-order-delivery-dates","IS NOT DISTINCT FROM"]
```

**Context:** A sales order line saved at the Capacity level is checked by an Inngest job that reads the line, runs the shop schedule simulation, then writes the result.

**Problem:** Reading the line at the start protects against an old event, not against a save that lands during the simulation. The job wrote a result for the old quantity over the newer one, and credited a newer kept date to the user whose save started the job.

**Rule:** Walk the timeline read → slow work → write with a second save in the middle. Make the write conditional on the inputs that were read (`WHERE col IS NOT DISTINCT FROM v.col … RETURNING id`), and raise side effects only for the rows written. Put in the event what the triggering save wrote, so the job can tell when a later save has replaced it.

**Applies to:** Every deferred check or recalculation that writes a result computed from a row a user can still edit.

## A `NonRetriableError` subclass must keep its name

```scope
id: a-nonretriableerror-subclass-must-keep-its-name
paths: ["packages/jobs/src/inngest/**"]
triggers: ["NonRetriableError","RetryAfterError","AssemblerJobError"]
```

**Context:** `AssemblerJobError extends NonRetriableError` (`packages/jobs/.../tasks/assembler-client.ts`) set `this.name = "AssemblerJobError"`.

**Problem:** `@carbon/lib` (which creates the Inngest client, so runs the functions) and `@carbon/jobs` resolve different installed copies of `inngest`, so `error instanceof NonRetriableError` is false inside the SDK. Its fallback is `error.name === "NonRetriableError"`, which the rename defeated. Every "give up" error was retried twice, as 500s from `/api/inngest`, before `onFailure` ran.

**Rule:** Never set `name` on a subclass of an Inngest error class (`NonRetriableError`, `RetryAfterError`); carry what tells it apart in another field (`code`). Check it against the client's copy: `createRequire("packages/lib/package.json").resolve("inngest")`.

**Applies to:** Every error class thrown from an Inngest function in `@carbon/jobs` or `@carbon/ee`.

## A push service's 401 or 403 does not mean the subscription is dead

```scope
id: a-push-service-s-401-or-403-does-not-mean-the-subscription-i
paths: ["packages/jobs/src/inngest/functions/notifications/push-outcome.ts","packages/jobs/src/inngest/functions/notifications/send-push.ts"]
triggers: ["pushDeliveryOutcome","web-push"]
```

**Context:** After the VAPID key changed, WNS answered 401 for a subscription made with the old key, and FCM answers 403 for the same case. Deleting the row on 401/403 was proposed so such rows stop failing (2026-10-09).

**Problem:** Apple's push service answers 403 when it refuses our own token (`BadJwtToken`, for example a contact address it does not accept). That refusal hits every Safari subscription at once. A delete on 403 would remove every Safari row on each push, the page load would save them again, and no Safari user would ever get a push, with no error anywhere.

**Rule:** Delete a subscription only on 404 or 410. On 401 or 403, log a warning with the push service's body and keep the row (`pushDeliveryOutcome` → `rejected`). An old-key row is replaced on the browser's next page load or ages out.

**Applies to:** `packages/jobs/src/inngest/functions/notifications/push-outcome.ts`, `send-push.ts`; any Web Push sender.

## Inngest dev: an event fired before its function's first registration wedges the run

```scope
id: inngest-dev-an-event-fired-before-its-function-s-first-regis
paths: ["packages/jobs/src/inngest/index.ts"]
triggers: ["inngest.createFunction"]
```

**Context:** Adding a new Inngest function and firing its event from a route during local development.

**Problem:** If the event fires before the dev server has registered the new function, the run sits "Running" forever — and per-key `concurrency` then queues every retry behind the wedged run, so nothing ever executes. The dev server's state is in-memory.

**Rule:** After adding or renaming an Inngest function, reload the Inngest dev server (`crbn reload inngest`) before firing its event; if a run is already wedged, cancel it and re-fire. Check `http://localhost:<PORT_INNGEST>/runs` when a background job seems to do nothing.

**Applies to:** `packages/jobs/src/inngest/`, local dev via `crbn up`.

## A new key in an Inngest step's return breaks runs in flight at deploy

```scope
id: a-new-key-in-an-inngest-step-s-return-breaks-runs-in-flight
paths: ["packages/jobs/src/inngest/functions/**"]
triggers: ["step.run("]
```

**Context:** The `notify` function's step `filter-recipients-by-preference` returned `{ emailRecipientIds, slackRecipientIds }`. A change added a third recipient-id key to the same step, under the same step id, and the code after it read that key's `.length` (2026-10-08).

**Problem:** Inngest replays a completed step from its memoized output. A run that started before the deploy and resumes after it gets the OLD output, without the new key, so `.length` throws and the notification fails. Typecheck cannot see it: the type describes the new code, not the stored output. Self-review caught it before merge.

**Rule:** When a step's return grows a key, read that key with a default (`newKey = []`) and comment why, or rename the step id so old runs re-execute it (only when the step is idempotent). Never assume a memoized step output has the current shape.

**Applies to:** every `step.run` in `packages/jobs/src/inngest/functions/**` whose return shape changes.

## A write that changes nothing still costs a queue message, an Inngest event and a function run

```scope
id: a-write-that-changes-nothing-still-costs-a-queue-message-an
paths: ["packages/planning/src/scheduling/*.ts","packages/database/src/event-system/functions/dispatch_event_batch.sql"]
triggers: ["dispatch_event_batch","is distinct from","IS DISTINCT FROM"]
```

**Context:** `/api/inngest` was the largest consumer on the ERP deployment (2026-10-01
traces). The audit handler's log was mostly "Skipping: no meaningful diff for UPDATE on
jobOperation".

**Problem:** The scheduler's write step issued one `UPDATE jobOperation` per operation on
every regen, always setting `updatedAt`, and re-stamped `status = 'Ready'` on operations that
were already Ready. `dispatch_event_batch()` queued every one of those updates, the drainer
sent them to Inngest ten at a time, and the audit, search and embedding handlers then threw
them away. Nothing was wrong in any single place; the waste was the sum.

**Rule:** A bulk writer guards its UPDATE on the values it writes (`updatePlacements` in
`persist-location.ts` adds an `is distinct from` test per written column, cast to the column's
type, so DATE and timestamptz are matched in their own type) rather than writing every row and bumping `updatedAt`. The trigger is the backstop: an
UPDATE that changes only `updatedAt` / `updatedBy` / `embedding` is not queued for AUDIT,
SEARCH or EMBEDDING (`20261001195204`). When forking `dispatch_event_batch()` into a new
migration, fork the NEWEST definition; the `event-ignored-columns` check (`@carbon/checks`)
fails if the filter is lost.

**Applies to:** `packages/planning/src/scheduling/`, any job or route that rewrites many rows
of a table with event subscriptions, and every migration that redefines
`dispatch_event_batch()`.

## An event sent at commit races every write the caller makes after the insert

```scope
id: an-event-sent-at-commit-races-every-write-the-caller-makes-a
paths: []
triggers: ["modelUpload","model-optimize"]
```

**Context:** New `modelUpload` rows start `model-optimize` from a statement handler, and pg_net sends the event when the transaction commits.

**Problem:** The part and tool forms inserted the row and uploaded the file at the same time (`Promise.all`). The quote drop inserted the row, then staged the file. In both, the optimise could start before its file existed and fail as "file not found".

**Rule:** When an insert starts a job, finish everything that job reads before the insert: stage the file, then insert the row. Keep a backstop for an event that is lost (the reaper resends the start once).

**Applies to:** any table whose statement handler or interceptor sends an Inngest event.

## An Inngest wait holds no concurrency slot, and a retry replays memoized steps

```scope
id: an-inngest-wait-holds-no-concurrency-slot-and-a-retry-replay
paths: ["packages/jobs/src/inngest/functions/tasks/assembler-client.ts"]
triggers: ["step.waitForEvent","step.sleep","step.invoke","runAssemblerJob","?wait="]
```

**Context:** `runAssemblerJob` (`packages/jobs/src/inngest/functions/tasks/assembler-client.ts`) used to poll the assembler inside one `step.run` and throw when its budget ran out. Each poll was a long poll, `GET /v1/jobs/{id}?wait=25`.

**Problem:** Three assumptions were wrong. A comment said a waiting run holds a slot of the function's `concurrency`; `step.waitForEvent`, `step.sleep` and `step.invoke` hold none. But an executing step does count against its function's concurrency key. Each long poll held a slot of the shared assembler key for up to 35 seconds, so a burst of uploads filled the key with waits, not work. And a throw outside a step does not redo the work: the retry replays every memoized step from its stored output, so the same check throws again with the same input.

**Rule:** Inside a step, make the request short. Wait with `step.waitForEvent` (or `step.sleep`) in slices, and poll once per slice in its own step. Treat a 5xx answer as "unreachable", not as a lost job. To retry the external work, do it in a new step (a resubmit with a new step id), never by throwing. Charge an action's time budget from when the service starts it, not from the submit.

**Applies to:** any Inngest function that waits on or polls an external service.

## The local Inngest dev server (v1.19.4) can't handle `debounce` — it errors on every debounce item

```scope
id: the-local-inngest-dev-server-v1-19-4-can-t-handle-debounce-i
paths: ["packages/jobs/src/inngest/functions/events/queue.ts"]
triggers: ["debounce:"]
```

**Rule:** Don't rely on `debounce` for any Carbon Inngest function validated against the local dev server — it's broken there. If you must coalesce many *separate* transactions in a burst, do it at the DB/application layer, not with `debounce`. Verify any flow-control choice by watching `docker logs <inngest container>` for `error handling queue item` during a burst, not just by trusting the config. The rest is in `.claude/rules/event-system.md`.

**Applies to:** `packages/jobs/src/inngest/functions/events/queue.ts`; any new Inngest function reaching for `debounce`/flow-control that will be exercised in local dev.

## A cron that walks every tenant must isolate each tenant

```scope
id: a-cron-that-walks-every-tenant-must-isolate-each-tenant
paths: ["packages/jobs/src/inngest/functions/**/*sweep*.ts","packages/jobs/src/inngest/functions/**/accounting-reconciliation*.ts","packages/jobs/src/inngest/functions/**/accounting-consolidation*.ts","packages/jobs/src/inngest/functions/scheduled/mrp.ts","packages/jobs/src/inngest/functions/integrations/accounting-auth-failure.ts"]
triggers: ["runIsolatedCompanyStep","AccountingAuthError","cron:"]
```

**Rule:** Every cron with a per-company loop, not only the accounting ones, runs one `step.run` per tenant, wrapped in `try/catch` that records `{ error }` and continues, and returns the per-tenant outcomes so the run output says who failed. The rest is in `.claude/rules/accounting-sync-handlers.md` (Per-tenant isolation) and `.claude/rules/mrp-system.md` (the MRP cron and the step ceiling).

**Applies to:** `packages/jobs/src/inngest/functions/**` — every cron with a per-company loop (`accounting-*-sweep`, `accounting-reconciliation`, `accounting-consolidation`, `scheduled/mrp.ts`); use `runIsolatedCompanyStep` (`integrations/accounting-auth-failure.ts`) for the accounting ones.

## A restore told the change log but not the open tabs

```scope
id: a-restore-told-the-change-log-but-not-the-open-tabs
paths: ["packages/jobs/src/inngest/functions/tasks/company-restore.ts"]
triggers: ["session_replication_role","wipeAndLoad","CHANGE_LOGGED_TABLES","REALTIME_TABLES"]
```

**Rule:** When a stale client list is suspected, compare the ids in `window.clientCache.getQueryData(["live", companyId, name])` with the database before reading code. The rest is in `.claude/rules/realtime-system.md`.

**Applies to:** `packages/jobs/src/inngest/functions/tasks/company-restore.ts` (`wipeAndLoad`); any new job that sets `session_replication_role`.

## Code outside an Inngest step runs again after every step

```scope
id: code-outside-an-inngest-step-runs-again-after-every-step
paths: ["packages/jobs/src/inngest/functions/**"]
triggers: ["step.sendEvent","step.run","NonRetriableError"]
```

**Context:** Printing a Make kanban to a printer printed the Create card only, never Start or Complete (2026-10-28).

**Problem:** `print-job` wrote its `printJob` rows in the function body and called `step.sendEvent` per job. Each step makes Inngest invoke the function again from the top with the finished steps memoized, so the body ran again: its 30 s duplicate guard found the job the first pass had just written and threw `NonRetriableError`. Every document with more than one label (kanban cards, a receipt's serials) printed its first label only, and the run read as a "duplicate" rather than a failure.

**Rule:** In an Inngest function, every database read that decides something and every write goes inside a `step.run`; the body between steps must be safe to run again. Collect the events in the step and send them with one `step.sendEvent` after it.

**Applies to:** `packages/jobs/src/inngest/functions/**` — any function that writes outside `step.run` and then calls a `step.*` method.

## Inngest `concurrency: { limit: 0 }` is no capacity, not unlimited

```scope
id: inngest-concurrency-limit-0-is-no-capacity-not-unlimited
paths: ["packages/checks/src/conformance/no-zero-concurrency.ts"]
triggers: ["concurrency:"]
```

**Context:** Moving webhooks onto the event system. The `WEBHOOK` handler had never actually run — webhooks went through 39 pg_net triggers, so the handler was dead code. `webhook.ts` declared `concurrency: { limit: 0 }`, and once a subscription made it live, every delivery sat in `QUEUED` forever.

**Rule:** A handler with zero subscriptions is dead code whose config is never exercised, so any bug in it surfaces only when something makes it live — when wiring an existing-but-unused handler, fire it end-to-end rather than trusting that it worked before. With a concurrency `key`, `limit: 1` is the usual intent — serialize per record/company. The rest is in the `no-zero-concurrency` check (`@carbon/checks`).

**Applies to:** `packages/jobs/src/inngest/**` `createFunction` options; `packages/checks/src/conformance/no-zero-concurrency.ts`.

## One Inngest send carries at most 512 KB, and a rendered email is about 17 KB

```scope
id: one-inngest-send-carries-at-most-512-kb-and-a-rendered-email
paths: ["packages/jobs/src/inngest/functions/notifications/notify.ts"]
triggers: ["step.sendEvent","EMAIL_CHUNK","carbon/send-email"]
```

**Context:** `notify` rendered every recipient's notification email in one step, then sent all the `carbon/send-email` events with one `step.sendEvent` (2026-10-09).

**Problem:** One rendered `NotificationEmail` is about 16.9 KB, because the event carries the full HTML. Inngest accepts at most 512 KB in one send and 4 MB in one step's output. So email to about 30 recipients or more could fail the send, and about 240 filled the step. A group notification reaches those sizes; a test with one recipient never does.

**Rule:** Size a fan-out by its bytes, not its count. When each event carries a rendered body, render and send it in chunks (`EMAIL_CHUNK` in `notify.ts`), each chunk in its own step with an indexed id (`render-emails-${index}`). A new step id replays a run in flight at deploy, so a send step that changes id sends again for those runs.

**Applies to:** `packages/jobs/src/inngest/functions/notifications/notify.ts`; any job that fans out events with large payloads.
