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

Three sequences still collapse by design, and their tiles should be labelled
accordingly: a quote revised and re-sent, a receipt voided and re-posted, an
order reopened and re-confirmed. Each counts once. Read those tiles as
"documents that ever reached this state", never as "times someone did this".

## What it does not cover

Deliberate gaps, so nobody reads a zero as "no work happened":

| Path | Why | What would fix it |
|---|---|---|
| `scrap_reported` from the MES floor (`apps/mes/app/routes/x+/scrap.tsx:37`) | The `productionQuantity` row is created inside the `issue` Deno function and its id is never returned to the route, so there is no key that makes one posting distinct. Keying on the operation would under-count a shift's repeat postings. | Return the inserted id from the `issue` function. |
| `production_quantity_reported` serial and batch branches | Same function, same reason (`functions/issue/index.ts:1117`, `:1266`). The untracked branch goes through `insertProductionQuantity` and *is* covered. | As above. |
| ~~`job_completed` via the automatic path~~ | Covered. `sync_finish_job_operation` runs inside the same transaction as the operation status flip, so `finishJobOperation` reads the job back and emits `path: "auto"` when it flipped. Keyed on `jobId`, so it collapses with the manual route. | — |
| `quote_accepted` from the customer portal | Covered, but anonymous — `actorId` is deliberately null for a customer's own acceptance. | Nothing; this is correct. |
| `job_created` via MCP or a customer workflow | Covered, but `source` is `unknown`. Both dispatch `production_insertJob` through a generic `(call, context, inputs)` signature with nowhere to put an option. Reported honestly rather than defaulted to `erp`, which would file automation as human work. | Thread a provenance field through the dispatch contract, or read the `workflow_run_id` JWT claim the event system already captures. |
| `job_created` via the deprecated `upsertJob` | Not covered. Inserts a `job` row directly (`production.service.ts`) and is still exposed as an MCP tool. | Route it through `insertJob`, or delete it. |

### Write paths no app-layer capture can see

Found by reading every entry point for each event, not by inspection of the
routes I happened to instrument. None of these are fixable from a route
handler, and each one makes the corresponding count a floor rather than a
total.

| Path | Reaches | Note |
|---|---|---|
| **PostgREST with a `carbon-key`** — `PATCH /rest/v1/job`, `/salesOrder`, `/purchaseOrder`, `/quote`, `/pickingList`, `/salesInvoice` | every status-change event | Carbon's public API is the generated PostgREST surface. An API key with the module's `_update` scope can set any status directly. Structurally invisible to app code. |
| **Deno edge functions invoked directly** — `post-receipt`, `post-shipment`, `post-sales-invoice`, `post-purchase-invoice`, `post-picking`, `schedule`, `convert` | the four posting events, `picking_list_completed`, `job_released` | `requirePermissions` accepts a `carbon-key`, so these are callable without ever entering the app. |
| **Postgres trigger `update_picking_list_status_trigger`** | `picking_list_completed` | The header completes as a consequence of line picks, not a status call — so the two instrumented routes see only the subset a human closed by hand. |
| **`schedule` with `mode: "initial"`** sets `job.status = 'Ready'` in Kysely | `job_released` | Latent today via `packages/jobs/.../recalculate.ts:95`; the two live callers also call `updateJobStatus`, which does emit. |
| **Inngest `carbon/post-transaction`** | receipt, shipment, purchase-invoice posts | Registered and fully wired, with no in-repo sender. Silent the day one appears. |
| **Paperless Parts webhook** inserts a `salesOrder` at `Confirmed` | `sales_order_confirmed` | A real integration, entirely outside the confirm route. |
| **MES inspection-lot disposition** (`inspection-lot.$id.disposition.tsx`) | `scrap_reported` | Scrap that a customer would absolutely call scrap. Emits nothing today. |
| **MCP tools** — `updateJobStatus`, `updateSalesOrderStatus`, `releaseSalesOrder`, `finalizePurchaseOrder`, `upsert*` | most events | Covered *only* where the capture sits in the service rather than the route, because MCP dispatches into services by name. `quote_sent` gets this right; the route-level captures do not. |

That last row is the pattern worth acting on: **instrument the service choke
point, not the route**, wherever the service is the single writer. It covers
MCP and API callers for free. The route-level placements here trade that away
for properties only the route knows (`emailed`, `source`, the derived status).

Everything above is the honest ceiling of the app-layer approach. Closing it
means the event-system queue handler (a Postgres trigger sees every one of
these, since they all end in a row change) or changes inside the Deno
functions.

## Verifying it after deploy

Nothing is observable until this is on `main` and deployed — the emitter is gated
on `POSTHOG_PROJECT_PUBLIC_KEY`, which is unset in local development by design.
`VERIFICATION.md` beside this file is the runbook: what to check at one hour, one
day and three days, with the exact queries and the pass criteria for each.
