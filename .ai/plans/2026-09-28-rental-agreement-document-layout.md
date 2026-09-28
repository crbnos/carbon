# Rental agreement: sales-order document layout

Brad (2026-09-28): the agreement has line items, so lay it out like a sales order /
quote. Terms stay in the center (no editable properties panel). Ships in the rentals PR.

## Shape

- `x+/rental-agreement+/$id.tsx` — `PanelProvider` + top-bar header + `ResizablePanels`
  (explorer + center `<Outlet />`, no properties panel). Model: `sales-return-order+/$id.tsx`.
- Header (`RentalAgreementHeader`) — top bar like `SalesReturnOrderHeader`: explorer toggle,
  id → details, copy, more menu (Delete), status + Past end date, actions
  (Invoice / Cancel / Close / Activate, same confirms as today).
- Explorer (`RentalAgreementExplorer`, new) — one row per unit (thumbnail, unit id, item,
  status); click → `/$lineId/details`; row menu Delete (Draft); footer **Add Unit** opens
  the unit form as a modal (Draft).
- `/details` — `RentalAgreementSummary` (stat row + customer / term / billing rows), Units
  table, Charges, Billing Periods, Deposits, then the terms form (`RentalAgreementForm`).
- `/$lineId/details` — the unit page: status + Deliver / Return / Sell, the unit form as a
  card (editable while Draft), then that unit's charges and billing periods.

## Tasks

- [x] `RentalAgreementLineForm` takes `type: "card" | "modal"`; the modal closes on submit.
- [x] Charge and Return forms take an `action`, close on submit, open from the page
      (no route navigation — a modal route would blank the center behind it).
- [x] `useRentalLineActions` — one home for Deliver / Return / Sell / Delete confirms,
      used by the units table, the explorer and the unit page.
- [x] Header → top bar; stat card → `RentalAgreementSummary`.
- [x] `RentalAgreementExplorer`.
- [x] `$id.tsx` shell; `$id.details.tsx` renders the summary + terms form;
      `$id.$lineId.details.tsx` renders the unit page.
- [x] Line-scoped actions redirect to `requestReferrer(request)` (fall back to details) so
      acting from the unit page stays there; line delete keeps details.
- [x] Docs: sales `AGENTS.md` ("one scrolling page"), rental-agreements docs page.
- [x] Verify: biome, `turbo run typecheck --filter=erp`, sales vitest (41 pass)
- [ ] Browser check — blocked: the dev login fails (stale dev server)
