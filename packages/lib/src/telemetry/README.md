# Work-event telemetry

Server-side capture of *work done on the platform* — jobs released, quotes sent,
POs issued — as opposed to screens opened, which is all Carbon measured before.

`capture.ts` is the emitter, `events.ts` is the typed catalog, `idempotency.ts`
mints the stable event id. The full 47-event catalog this draws from, with the
deferred waves and the reasoning per event, is
`adoption-tracking/work-done-events.md` in the parent directory of this repo.

## Adding an event

1. Add it to `WorkEvents` in `events.ts` with its properties.
2. Add it to `WORK_EVENT_MODULE` and `WORK_EVENT_RECORD_KEY`.
3. Call `trackWorkEvent("name", { ... })` at the seam.

The type map is the contract: an unknown name or a missing property will not
compile. Payloads carry ids, enums, counts and quantities — never money, part
numbers, names or free text (see the header of `events.ts` for why).

## Where to put the call

Below every early return and every rollback catch, so a reverted post never
counts. The four posting routes already have a `raiseMoment` sitting in exactly
the right place; put the capture beside it.

Pick the record whose id makes one occurrence unique. For a status change that is
the document; for repeatable work — a production posting, an operator clocking on
— it is the row that posting created, never the operation it was against.

## What it does not cover

Deliberate gaps, so nobody reads a zero as "no work happened":

| Path | Why | What would fix it |
|---|---|---|
| `scrap_reported` from the MES floor (`apps/mes/app/routes/x+/scrap.tsx:37`) | The `productionQuantity` row is created inside the `issue` Deno function and its id is never returned to the route, so there is no key that makes one posting distinct. Keying on the operation would under-count a shift's repeat postings. | Return the inserted id from the `issue` function. |
| `production_quantity_reported` serial and batch branches | Same function, same reason (`functions/issue/index.ts:1117`, `:1266`). The untracked branch goes through `insertProductionQuantity` and *is* covered. | As above. |
| `job_completed` via the automatic path | `sync_finish_job_operation` completes the job inside Postgres with no application call site. Only the manual complete route emits, tagged `path: "manual"`. | A queue handler on the `job` status diff. |
| `quote_accepted` from the customer portal | Covered, but anonymous — `actorId` is deliberately null for a customer's own acceptance. | Nothing; this is correct. |

Everything above is the honest ceiling of the app-layer approach. Closing it
means either the event-system queue handler or changes inside the Deno functions.

## Verifying it after deploy

Nothing is observable until this is on `main` and deployed — the emitter is gated
on `POSTHOG_PROJECT_PUBLIC_KEY`, which is unset in local development by design.
`VERIFICATION.md` beside this file is the runbook: what to check at one hour, one
day and three days, with the exact queries and the pass criteria for each.
