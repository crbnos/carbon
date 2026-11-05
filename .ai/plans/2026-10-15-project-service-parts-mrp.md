# Project and service parts in MRP

Three changes to how plan-line materials (`projectElementMaterial`) reach MRP
through `openProjectMaterialLines`. Asked by Brad, 2026-10-15.

## Decisions

- **Purchase to Order is demand.** The view takes every method but Make to Order, as
  `openJobMaterialLines` does. A plan line's own PO line (Create PO line,
  `purchaseOrderLineId`) that the project consumes at receipt is not supply in
  `openPurchaseOrderLines`, so it reduces the line's demand instead: by the ordered
  quantity while it is open, by the received quantity once it is received complete,
  closed or rejected. One SQL predicate, `purchase_order_line_consumed_by_project`,
  now backs both views.
- **A service order gets a Planned status.** Draft → Planned → Scheduled → In
  Progress. A Draft order's Service project is Draft, so its parts are not demand and
  it takes no charge (`assertChargeable`). Planned and later map to Released. The
  roll-up never returns an order to Draft: with no live visit, a Draft order stays
  Draft and any other open order is Planned. Resume and Reopen move to Planned.
  **Mark as Planned** moves a Draft order. Existing Draft orders with a project charge
  become Planned; the rest stay Draft and their project becomes Draft.
- **A service part is due at the next visit.** The required date falls back from the
  line's date to the element's start, then the next unfinished visit's planned start
  (company-local date), then the project's start.

## Tasks

- [x] Migration 1: add `Planned` to `serviceOrderStatus`.
- [x] Migration 2: backfill, predicate function, both views.
- [x] `pnpm run generate:types`.
- [x] `service.models.ts`: statuses, roll-up, actions, transitions, urgency.
- [x] `service.server.ts` `projectStatusOfOrder`; `service-orders.ts` inserts a Draft project.
- [x] `complete-service-order` completes a Planned order.
- [x] Header, status route, status badge and colour, Draft-only fields.
- [x] Datasets: `ServiceOrderSpec.status`, tier 09 project status, a Planned order per dataset. Satellite's Refurbishment is the Planned order: its RMA `bus-repair` returns the Expired asset, and a second open order on that serial would block the receipt.
- [x] Tests: `apps/erp/test/service-models.test.ts`, `service-orders.test.ts`.
- [x] Docs: `field-service.md`, `projects-system.md`, `mrp-system.md`, service `AGENTS.md`, reference page.
- [x] Verify: typecheck (erp, server-functions, database), tests, Biome, `db:check:datasets`.

## Verification (2026-10-15)

- Migrations applied (`pnpm db:migrate`). A rolled-back SQL scenario on a Released Service project gave these results. A Purchase to Order line of 10 with no PO line → 10. With an open consumed PO line of 4 → 6, and the PO line is not supply. Received 3, then received complete → 7. Make to Order → no row. The Scheduled order's lines are now due on the visit date.
- Typecheck green: `erp`, `@carbon/server-functions`, `@carbon/database`, `@carbon/utils`, `@carbon/planning`.
- Tests green: `apps/erp/test/service-models.test.ts`, the charge route test, 10 service server-function suites, `@carbon/planning` (339).
- `pnpm db:check:datasets`: all 4 datasets pass.
- Failures not caused by this change: `db:check:backups` (5 tables on `main` that this branch does not have yet); `clobbers` (`complete_job_to_inventory`); the `@carbon/checks` conformance test (`document-sequence-synced` in `seed-data.ts`).
- Not done: no browser check.
