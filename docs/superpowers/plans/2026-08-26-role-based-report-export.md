# Role-Based Report Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing reporting area export complete, filtered report results as CSV and make report visibility follow the application's real authorization model, while preparing a stable contract for future personnel-specific report policies.

**Architecture:** Keep report calculations and data authorization in the existing route loaders and report services. Add one shared CSV serialization/download path for report UI, a metadata catalog for report identity and required permissions, and a catalog filter in the reports hub. Each report route remains its own server-side authorization boundary; hiding a card is only a usability layer, never the security control.

**Tech Stack:** React Router route modules, React/TypeScript, Vitest, `json-2-csv`, existing `requirePermissions`/`usePermissions`, Carbon UI components.

## Global Constraints

- Preserve unrelated dirty worktree changes.
- Do not add a Crystal Reports-style drag/drop designer, scheduled delivery, PDF, or Excel in this iteration.
- CSV export must represent the complete current filtered result, not the visible virtualizer window.
- Do not move business calculations into the browser; export the same derived values already rendered by the report.
- Do not weaken route authorization. Every report loader and report-specific API remains protected by `requirePermissions`.
- Do not claim personnel-level separation that the current permission model cannot express. The current report implementations are all `accounting`-gated and the runtime roles are only `employee`, `customer`, and `supplier`; finer department policies require a later authorization decision and matching route/data gates.
- Keep labels translatable through the existing Lingui conventions.

## Task 1: Define the export and report-catalog contracts with tests

**Files:**

- Add `apps/erp/app/modules/accounting/ui/Reports/exportReport.test.ts`
- Add `apps/erp/app/modules/accounting/ui/Reports/reportCatalog.ts`
- Add `apps/erp/app/modules/accounting/ui/Reports/reportCatalog.test.ts`
- Update `apps/erp/app/modules/accounting/ui/Reports/index.ts`

- [ ] Write failing tests for a shared CSV serializer: header order is stable, commas/quotes/newlines are escaped, formula-like text cells are prefixed as text, numeric values remain numeric text, and empty input produces no download rows.
- [ ] Write failing tests for report metadata and visibility: each current report has a stable key, category, route, CSV support, and required permission; a user without the required permission is excluded; an employee with `accounting` view access sees the currently implemented accounting reports; non-employees do not receive the employee report catalog.
- [ ] Define the minimal `ReportDefinition` metadata contract: `key`, translated label/description, category, route, default pin state, allowed runtime role, required view permission, and supported export formats.
- [ ] Define the current catalog from the report hub's existing list rather than duplicating report keys in multiple places.
- [ ] Export the catalog and pure CSV helpers through the existing Reports barrel.
- [ ] Run the focused tests and confirm they fail for the expected missing implementation before proceeding.

**Verification:**

```powershell
Set-Location -LiteralPath 'E:\6.Factory OS\carbon-runtime\carbon'
pnpm --filter erp exec vitest run app/modules/accounting/ui/Reports/exportReport.test.ts app/modules/accounting/ui/Reports/reportCatalog.test.ts
```

## Task 2: Consolidate CSV generation without changing report semantics

**Files:**

- Update `apps/erp/app/modules/accounting/ui/Reports/exportReport.ts`
- Update `apps/erp/app/routes/x+/reports+/purchases.tsx`
- Update `apps/erp/app/routes/x+/reports+/analytics.$reportKey.tsx`
- Update `apps/erp/app/modules/accounting/ui/Reports/index.ts` if exports need adjustment

- [ ] Implement the tested pure CSV serializer and browser download helper in `exportReport.ts`.
- [ ] Keep the existing financial statement exporters (`exportPeriodReport`, `exportExecutivePnl`, `exportTrialBalance`) on the shared helper and preserve their current column order and derived values.
- [ ] Replace the duplicated inline Blob/anchor CSV code in Purchases and Analytics with the shared helper.
- [ ] Preserve the current pivot tree and filter state as the export source; do not export only the currently rendered virtualized rows.
- [ ] Add regression coverage for the pivot row conversion path where practical, reusing existing `pivotData` tests rather than introducing a second pivot implementation.
- [ ] Run the focused report tests and the TypeScript check for the ERP app.

**Verification:**

```powershell
Set-Location -LiteralPath 'E:\6.Factory OS\carbon-runtime\carbon'
pnpm --filter erp exec vitest run app/modules/accounting/ui/Reports/exportReport.test.ts app/modules/accounting/ui/Reports/pivotData.test.ts app/modules/accounting/ui/Reports/executivePnl.test.ts
pnpm --filter erp typecheck
```

## Task 3: Make the Reports hub consume the catalog and real permissions

**Files:**

- Update `apps/erp/app/routes/x+/accounting+/reports.tsx`
- Update `apps/erp/app/modules/accounting/ui/Reports/reportCatalog.ts`
- Update `apps/erp/app/modules/accounting/ui/Reports/reportCatalog.test.ts`

- [ ] Remove the route-local duplicate report definition list and build the localized view model from the shared catalog.
- [ ] Use `usePermissions()` to filter report cards and pinned reports by the catalog's required permission and runtime role.
- [ ] Ensure pin overrides cannot make an inaccessible report visible; filter access before pinned/category/search rendering.
- [ ] Keep the existing `requirePermissions(request, { view: "accounting", role: "employee" })` gates on the Reports hub and current report routes.
- [ ] Add a test that an inaccessible report cannot reappear through a saved pin or saved view.
- [ ] Document in code that this iteration's report-level access is bounded by existing module permissions; do not introduce a fake `finance_manager`/`production_manager` role.

**Verification:**

```powershell
Set-Location -LiteralPath 'E:\6.Factory OS\carbon-runtime\carbon'
pnpm --filter erp exec vitest run app/modules/accounting/ui/Reports/reportCatalog.test.ts
pnpm --filter erp typecheck
```

## Task 4: Add exports to the table-based aging and inventory reports

**Files:**

- Update `apps/erp/app/routes/x+/reports+/ap-aging.tsx`
- Update `apps/erp/app/routes/x+/reports+/ar-aging.tsx`
- Update `apps/erp/app/routes/x+/reports+/inventory-valuation.tsx`
- Update `apps/erp/app/modules/invoicing/ui/Workbench/ARAPWorkbench.tsx`
- Update `apps/erp/app/modules/inventory/ui/Valuation/InventoryValuationWorkbench.tsx`
- Add focused pure-row tests beside the relevant module tests if extraction is needed.

- [ ] Extract the displayed aging rows into a pure, flat export shape containing the as-of date, counterparty/invoice identity, aging buckets, open amount, currency, and the active aging method.
- [ ] Add a Download CSV action to the shared AR/AP workbench that exports all loaded rows, not just expanded or visible rows, and uses the active side/title for the filename.
- [ ] Extract the displayed inventory valuation rows into a pure, flat export shape containing location/item identity, quantities, total value, and the active as-of/group-by filters.
- [ ] Add a Download CSV action to the inventory valuation workbench using the same shared serializer.
- [ ] Keep tie-out panels and reconciliation actions out of the CSV unless they are already part of the displayed report row model; do not invent accounting facts in the export.
- [ ] Verify empty/error states do not trigger a misleading successful download.

**Verification:**

```powershell
Set-Location -LiteralPath 'E:\6.Factory OS\carbon-runtime\carbon'
pnpm --filter erp exec vitest run app/modules/invoicing/invoicing.reports.test.ts app/modules/inventory/inventory.models.test.ts
pnpm --filter erp typecheck
```

## Task 5: Browser and authorization acceptance

**Files:**

- No new product files unless verification exposes a defect.
- Record evidence in `docs/` only if the repository's existing acceptance convention requires it.

- [ ] Start the ERP dev server using the repository's existing development command and open the authenticated Reports hub.
- [ ] Verify an employee with accounting view access can open each current report and download CSV.
- [ ] Change filters/grouping and verify the downloaded file follows the changed state and includes the complete filtered result.
- [ ] Verify formula-like dimension text is preserved as text in the CSV.
- [ ] Verify a user lacking the required module permission cannot see the report card and receives the existing server-side denial when navigating directly.
- [ ] Verify the export button is absent or disabled for empty/error report states.
- [ ] Run the focused tests, ERP typecheck, and a production build before claiming completion.

**Verification:**

```powershell
Set-Location -LiteralPath 'E:\6.Factory OS\carbon-runtime\carbon'
pnpm --filter erp exec vitest run app/modules/accounting/ui/Reports app/modules/invoicing/invoicing.reports.test.ts
pnpm --filter erp typecheck
pnpm --filter erp build
```

## Deferred follow-up: personnel-specific report policies

- [ ] Inventory the actual employee-type/permission records used by target Chinese manufacturing tenants.
- [ ] Decide whether department-level report access belongs in existing module permissions or requires a dedicated report-permission resource.
- [ ] Add server-side “required any/all permissions” semantics only after that decision is approved.
- [ ] Register production, quality, sales, purchasing, inventory, and management reports against their authoritative data source and permission boundary.
- [ ] Add Excel/PDF renderers only after CSV acceptance and export audit requirements are stable.

