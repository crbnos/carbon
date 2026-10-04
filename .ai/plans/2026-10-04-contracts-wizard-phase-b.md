# Contracts — setup wizard, editable schedules, Phase B revenue

Spec: `.ai/specs/2026-10-02-contracts.md` (Phase A implemented; this plan is Phase B
plus a UI change Brad asked for on 2026-10-04). FX facts: `.ai/research/contract-exchange-rates.md`.

## Brad's decisions (2026-10-04)

1. **Wizard** — creating a contract is a five-step flow: Details → Products → Invoicing →
   Revenue → Review. Overrides the spec's "one page, not Rillet's wizard" (UI Changes).
   The contract page stays the place to work on a contract after Confirm.
2. **Draft at step 1** — Next on Details inserts the Draft; every later step edits that
   record through real endpoints. Steps are routes: `/x/contract/:id/setup/<step>`.
3. **Keep the conservation rule** — invoice-grid and revenue-grid edits only move money:
   each line's billed total = its computed total, and its revenue total = its billed
   total. The footer shows the residual; Confirm stays blocked until it is zero.
4. **Ship-to** — `customerContract.shipToCustomerLocationId`, copied onto drafted invoices.
5. **Build Phase B now** — stored per-line monthly revenue, editable while Draft
   (overrides the spec's "read-only" / "hand-edited revenue schedules out of scope"),
   and the GL engine that posts from it.

## Design decisions (this plan)

D1. **Revenue plan table** `customerContractRevenue` — one row per (line, calendar month),
    `amount` in contract currency, `status` `contractRevenueStatus`: Planned /
    Recognized / Recognized Externally. UNIQUE (companyId, customerContractLineId,
    periodStart). Same persistence model as the invoice schedule: an unedited Draft has
    no rows (the loader plans live); the first revenue edit, or Confirm, writes them.
    Rows are addressed by their natural key (lineId + month) — no `planned:` refs needed.
D2. **Revenue plan math** moves to `@carbon/database/contract-revenue-schedule`
    (`planRevenueSchedule`, `reconcileRevenueSchedule`, `validateRevenueEdit`), so the
    server functions and the dataset tier share it. A line's revenue total = Σ its
    invoice-schedule rows (adjustments and memo credits included), spread over
    `lineRevenueDates` by the line's method (Daily / Even Period). Months before
    `recognizeRevenueFrom` are `Recognized Externally`. `packages/utils/src/contract-revenue.ts`
    keeps `contractPositionPreview` and re-exports the rest.
D3. **Position = invoiced − recognized per line, in both currencies.** GL invariant per
    line: Deferred Revenue = max(N, 0), Contract Assets = max(−N, 0). Every movement
    (invoice, recognition, memo, VOID, opening) is applied by ONE pure function
    `applyContractMovement(position, amount, rate)` → `{ deferred, asset, fx }` legs
    (contract-currency + base). Base is carried at a weighted-average rate per pool
    (research open question 7, SAP RAR); clearing Contract Assets at an invoice books
    the base difference to `realizedExchangeGain/LossAccount`, never to revenue.
D4. **Movement ledger** `customerContractLedgerEntry` — one row per movement:
    `customerContractLineId`, `entryType` (Invoice / Recognition / Credit Memo / Void /
    Opening), source refs (`salesInvoiceLineId`, `memoId`, `revenueRecognitionScheduleId`,
    `customerContractRevenueId`), `deferredAmount`, `deferredBase`, `assetAmount`,
    `assetBase` (signed), `journalId`. Position = Σ by line. A Recognition entry
    cascades with its `revenueRecognitionSchedule` row (a recalculated Draft run drops
    both).
D5. **Recognition reuses the run.** `revenueRecognitionSchedule` gains
    `customerContractLineId`, `customerContractRevenueId`, `contractAmount`.
    `synthesizeContractRevenue` (added to `RUN_ROW_SYNTHESIZERS`) turns each due Planned
    revenue row into a Deferral row (Dr Deferred Revenue / Cr Sales) for the part the
    deferred pool covers and an Accrual row (Dr Contract Assets / Cr Sales) for the rest
    (base at the run date's rate), writes the ledger entries, and marks the plan row
    Recognized. Run posting is unchanged except: Project dimension from the line, and
    `documentType "Contract"`.
D6. **Invoice posting contract branch** — a `salesInvoiceLine` with
    `customerContractLineId` skips the Service deferral: Cr Contract Assets up to the
    asset pool, the rest Cr Deferred Revenue; no schedule rows. Negative amounts reverse
    (Dr Deferred up to the deferred pool, rest Dr Contract Assets). VOID applies the
    negation through the same function (entry type Void) instead of refusing.
D7. **post-memo contract branch** — a contract credit memo applies a negative movement
    per credited line (Dr Deferred up to the pool, rest Dr Contract Assets) and replaces
    `releaseContractDeferral`. Cancel adds negative catch-up revenue rows for months
    already Recognized after the new end date, so the asset clears in the next run.
D8. **Opening balance at Confirm** (migration): per line, Opening entry =
    Σ Billed Externally rows − Σ Recognized Externally revenue, at the contract's
    reference rate, no journal (the user's opening journal carries it).
D9. **Reconcile, never rewrite** — amend / cancel / revert / renewal / horizon roll call
    `reconcileRevenueSchedule` per touched line: Planned months are replaced by the new
    plan; a Recognized month whose new value differs adds the difference to the first
    Planned month on or after the effective date (a catch-up row is created when none).
D10. **Invoice grid ops** (Draft, extend `edit-schedule`): `setAmount` (invoice × line
    cell; one row per cell after the edit, units rescaled like split, deleting the row
    at 0), `addInvoice` (date + optional cell amounts; created with ≥ 1 row), `delete`
    (removes the invoice's rows — residual shows). Existing `move` stays for the date
    cell. move/split/merge/moveLine stay for the contract page's menus.
D11. **Revenue grid ops** (Draft, new `edit-revenue` action): `setAmount` (line ×
    month), `addMonth`, `deleteMonth`, `reset`. Confirm refuses a line whose revenue
    total ≠ its billed total.
D12. **Grid** — the shared `Table` with `editableComponents` (the inspection grid's
    machinery). New `EditableDate` cell (extend `~/components/Editable`). Rows =
    invoices / months, columns = contract lines, a footer row of residuals.
D13. **Wizard shell** — new `ContractSetup` layout: stepper (no shared one exists —
    create it in `ui/Contracts/ContractSetupSteps.tsx`), sticky footer with contract
    total + Back / Next. Next navigates; data is already saved.

## Tasks

- [x] **T1 Schema** — migration `contracts-phase-b`: enum `contractRevenueStatus`,
      enum `contractLedgerEntryType`, tables `customerContractRevenue`,
      `customerContractLedgerEntry`; `revenueRecognitionSchedule` +3 columns;
      `customerContract.shipToCustomerLocationId`; `customerContracts` view gains
      `shipToCustomerLocationId`, `recognizedToDate`. Authz manifest + RLS migration.
      `pnpm db:migrate && pnpm run generate:types`. Verify: types contain the tables.
- [x] **T2 Pure math + tests** — `packages/database/src/contract-revenue-schedule.ts`
      (plan / reconcile / validate), `packages/database/src/contract-position.ts`
      (`applyContractMovement`, `positionFromEntries`). Verify: vitest green.
- [x] **T3 Contract lifecycle** — `post-customer-contract`: invoice-grid ops (D10),
      `edit-revenue` (D11), confirm materializes revenue + checks + Opening (D8), amend /
      cancel / revert reconcile revenue (D9, D7 catch-up); `create-contract-invoices`:
      renewal + `rollHorizon` reconcile revenue, ship-to on drafted invoices.
      DB tests in `contract-lifecycle.test.ts`.
- [x] **T4 Posting** — `post-sales-invoice` contract branch + VOID (D6), `post-memo`
      (D7), `synthesizeContractRevenue` (D5), run post: Project dimension, revenue rows
      Recognized, close-task count. DB tests. ⚠ Shares files with uncommitted
      recalculate-run work in this worktree — wait for it to land or ask.
- [x] **T5 ERP data** — validators (`sales.models.ts`), `$id.schedule.tsx` new intents,
      `$id.revenue.tsx`, `update.tsx` ship-to field, `$id.tsx` loader exposes
      `lineTotals`, revenue rows (live or stored), residuals, ledger position.
- [x] **T6 Wizard UI** — routes `x+/contract+/new.tsx` (step 1 → insert → redirect to
      setup/products), `$id.setup.tsx` layout + `products` / `invoicing` / `revenue` /
      `review` children; `ContractProductsGrid`, `ContractInvoiceGrid`,
      `ContractRevenueGrid`, `ContractBillTo` (bill-to, address, ship-to, contact,
      terms), `EditableDate`. Contract page Invoices/Revenue cards reuse the grids while
      Draft. Copy in Lingui.
- [x] **T7 Data + docs** — dataset tier 04 seeds revenue rows (+ Opening entries) for its
      Active contracts, coverage floors; `docs/content/docs/reference/contracts.mdx`;
      sales `AGENTS.md`; spec changelog; lessons; `/translate`.
- [x] **T8 Verify** — scoped typechecks (database, utils, server-functions, erp), tests,
      Biome, `db:check:datasets`, browser walkthrough of the wizard at 1440/1024/390.

## Interfaces (T3 ⇄ T5/T6 contract — both sides build to exactly this)

### `post-customer-contract` input additions

`edit-schedule` → `edit` gains three intents (Draft, Planned invoices only, refs as today —
a stored id or `planned:<invoiceDate>`):

```ts
| { intent: "setAmount"; customerContractInvoiceId: string; customerContractLineId: string; amount: number }
    // the cell (invoice × line) becomes ONE non-adjustment row of `amount` (≥ 0). 0 deletes the
    // cell's rows; an invoice left empty is deleted. A cell with no rows yet gets a row whose
    // period is the invoice's other rows' period for that line, else the line's nearest
    // planned period, else [invoiceDate, invoiceDate]; units = amount ÷ (qty × unitPrice ×
    // (1 − discount)) when that is defined, else 1 with unitPrice = amount.
| { intent: "addInvoice"; invoiceDate: string; amounts: { customerContractLineId: string; amount: number }[] }
    // ≥ 1 amount > 0; rows as setAmount; if a Planned invoice already sits on the date the
    // amounts are added to it.
| { intent: "delete"; customerContractInvoiceId: string }
    // removes the Planned invoice and its rows; the lines show residuals.
```

New action `edit-revenue` (Draft only; the first edit writes the live plan, D1):

```ts
{ type: "edit-revenue"; customerContractId; asOf; edit:
  | { intent: "setAmount"; customerContractLineId: string; periodStart: string /* YYYY-MM-01 */; amount: number } // 0 deletes the row
  | { intent: "addMonth"; periodStart: string; amounts: { customerContractLineId: string; amount: number }[] }
  | { intent: "deleteMonth"; periodStart: string }   // every line's row in that month
  | { intent: "reset" } }                             // delete all rows → live plan again
```

`confirm` additionally: writes the revenue plan when none is stored; refuses (`{ revenueResiduals }`)
when any line's revenue total ≠ its billed total; writes Opening ledger entries (D8).

### Shared server helper (server-functions)

`packages/server-functions/src/post-customer-contract/revenue-writes.ts`:
- `billedTotals(trx, scope, contractId)` → `{ totals: Map<lineId, number>, lastPeriodEnds: Map<lineId, string> }`
  (Σ every schedule row incl. adjustments + memo credits; last periodEnd per line).
- `plannedRevenue(trx, scope, contract, lines)` → `ContractRevenueRow[]` (planRevenueSchedule with the above).
- `materializeRevenue(trx, scope, contract, lines)` — inserts the plan.
- `reconcileRevenue(trx, scope, contract, lines, lineIds, from)` — D9 per line.

### ERP loader (`$id.tsx`) additions to `ContractRouteData`

`lineTotals: Record<lineId, number>` (planned billed totals), `revenueRows` (stored rows, or the
live plan when none — each `{ lineId, periodStart, periodEnd, amount, status }`),
`revenueIsStored: boolean`, `revenueResiduals: Record<lineId, number>`, `ledgerPosition:
Record<lineId, ContractPosition>` (Active contracts).

### Routes

- `path.to.contractSchedule(id)` — existing; accepts the three new intents (amounts as numbers,
  `amounts` as a JSON field).
- `path.to.contractRevenue(id)` → `x+/contract+/$id.revenue.tsx` — action only, `update: sales`.
- `path.to.contractSetup(id, step)` → `x+/contract+/$id.setup.tsx` (layout) +
  `$id.setup.products.tsx`, `$id.setup.invoicing.tsx`, `$id.setup.revenue.tsx`,
  `$id.setup.review.tsx`. `new.tsx` is step 1 and redirects to `setup/products` on create.
  An existing Draft can reopen the wizard; an Active contract redirects to `contractDetails`.

## Changes during the build (2026-10-04)

| Change | Why |
|---|---|
| `customerContractLine.kind` → `revenueType`, enum `contractRevenueType` (migration `20261004202351`) | Brad: never name a field "Kind". The rule is in root `AGENTS.md` and `conventions-database.md`. |
| `customerContractLedgerEntry` gains `updatedBy` / `updatedAt` (migration `20261004202441`) | Every table with `createdBy` needs `updatedBy`. |
| Ship-to is copied onto drafted invoices through the new `salesInvoiceShipment.customerLocationId` (migration `20261004211336`) | The column did not exist. Brad approved the change on 2026-10-04. Sales rules and the invoice PDF read it too. |
| Details step: "Action on Completion", More Details always open, Sales Person = the current user, "Contract Close Date" with glossary term `contract-close-date`, no contract-type helper text | Brad's review of the wizard. |
| `reconcileRevenue` keeps a Planned month that a Draft run holds | An amendment must not delete a month the run is about to post. |
| Revenue edits refuse negative amounts in the server too | Only reconciliation writes a negative catch-up month. |
| The contract page's move / merge / split menus are removed | The invoice grid replaces them on a Draft. The server intents stay. |
| A confirmed contract's Revenue card shows the stored plan with a status per month | Phase B stores the plan, so the preview is only a fallback for contracts confirmed before it. |

Not committed: another session's uncommitted recalculate-run work shares `post-sales-invoice/index.ts`, `post-memo-transaction.ts`, `propose-revenue-recognition-run/index.ts` and `accounting.server.ts`. The posting changes build on its helpers. Commit after that work lands.
