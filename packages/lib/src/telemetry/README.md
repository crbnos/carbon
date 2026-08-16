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

**Immediately after the write that makes the work true**, not at the end of the
handler. Everything between the two is a chance to redirect out and lose the
event: the purchase-order route has five such exits — a failed PDF upload, a
failed document row, a PDF throw, the form validation, and a failed email — all
after the order is already finalized.

**Below a rollback catch is not the same as "only on success."** Carbon's
posting routes reset the document to Draft inside the catch and then *fall
through*, so a capture placed after the catch still fires on a reverted post.
Set a flag in the catch and test it. (`raiseMoment` sits in that position with a
comment claiming otherwise — it has fired on rolled-back receipts since #1294.
Left alone here: changing when customer workflows fire is a separate decision.)

**Watch for the second half of a lifecycle in another module.** `approveRequest`
in `~/modules/shared` is what releases a gated purchase order, and it never
returns to the finalize route — a single capture there counted the orders that
stopped at a threshold and missed every one that actually committed money.

Pick the record whose id makes one occurrence unique. For a status change that is
the document; for repeatable work — a production posting, an operator clocking on
— it is the row that posting created, never the operation it was against.

## Semantics: an event counts entry into a state

The id is (companyId, event, recordId, discriminator), so a document that
re-enters a state produces the same id and de-duplicates. That is right for a
double-clicked Post button and wrong for genuine repeat work, so where both
states are real occurrences, pass the state as the `discriminator` —
`purchase_order_finalized` (`gated` / `committed`) and `picking_list_completed`
(`Partial` / `Completed`) both do.

Still collapsing by design, and worth labelling that way on a dashboard: a quote
revised and re-sent, a receipt voided and re-posted, an order reopened and
re-confirmed. Each counts once. Read these tiles as "documents that ever reached
this state", never as "times someone did this".

## What it does not cover

Deliberate gaps, so nobody reads a zero as "no work happened":

| Path | Why | What would fix it |
|---|---|---|
| `scrap_reported` from the MES floor (`apps/mes/app/routes/x+/scrap.tsx:37`) | The `productionQuantity` row is created inside the `issue` Deno function and its id is never returned to the route, so there is no key that makes one posting distinct. Keying on the operation would under-count a shift's repeat postings. | Return the inserted id from the `issue` function. |
| `production_quantity_reported` serial and batch branches | Same function, same reason (`functions/issue/index.ts:1117`, `:1266`). The untracked branch goes through `insertProductionQuantity` and *is* covered. | As above. |
| ~~`job_completed` via the automatic path~~ | Covered. `sync_finish_job_operation` runs inside the same transaction as the operation status flip, so `finishJobOperation` reads the job back and emits `path: "auto"` when it flipped. Keyed on `jobId`, so it collapses with the manual route. | — |
| `quote_accepted` from the customer portal | Covered, but anonymous — `actorId` is deliberately null for a customer's own acceptance. | Nothing; this is correct. |
| `job_created` via MCP or a customer workflow | Covered, but `source` is `unknown`. Both dispatch `production_insertJob` through a generic `(call, context, inputs)` signature with nowhere to put an option. Reported honestly rather than defaulted to `erp`, which would file automation as human work. | Thread a provenance field through the dispatch contract, or read the `workflow_run_id` JWT claim the event system already captures. |

Everything above is the honest ceiling of the app-layer approach. Closing it
means either the event-system queue handler or changes inside the Deno functions.

## Verifying it after deploy

Nothing is observable until this is on `main` and deployed — the emitter is gated
on `POSTHOG_PROJECT_PUBLIC_KEY`, which is unset in local development by design.
`VERIFICATION.md` beside this file is the runbook: what to check at one hour, one
day and three days, with the exact queries and the pass criteria for each.
