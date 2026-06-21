---
paths:
  - "apps/erp/app/modules/quality/ui/RiskRegister/**"
  - "apps/erp/app/routes/x+/quality+/risks*.tsx"
  - "packages/database/supabase/migrations/*risk*.sql"
---

# Risk Register Module (Quality)

Tracks **risks and opportunities** tied to entities across Carbon (items, jobs,
customers, suppliers, work centers, quote lines, or general). Part of the
`quality` module — code lives under `apps/erp/app/modules/quality/`. Schema is
grounded in the migrations; **newest wins**.

## Schema — `riskRegister` table

Created `20251210060100_add-risk-registers.sql`, then evolved by three later
migrations (read the newest before trusting columns):

- `20251218024157_risk-register-improvements.sql` — added `type "riskRegisterType"`
  (NOT NULL DEFAULT `'Risk'`) and `notes JSON` (DEFAULT `'{}'`).
- `20260102015412_risk-registers-view.sql` — created the `riskRegisters` view.
- `20260323184848_add_updatedby_riskregister.sql` — added `updatedBy` (FK → `user`).

Columns: `id` UUID PK (`gen_random_uuid()` — **not** the usual `id('prefix')`),
`companyId`, `title` (required), `description`, `source "riskSource"` (required),
`sourceId TEXT` (id of the associated entity, generic), `severity INTEGER`
(CHECK 1–5), `likelihood INTEGER` (CHECK 1–5), `itemId TEXT` (FK → `item`,
ON DELETE SET NULL — a dedicated column, separate from `sourceId`),
`status "riskStatus"` (default `'Open'`), `type "riskRegisterType"` (default
`'Risk'`), `notes JSON`, `assignee`/`createdBy`/`updatedBy` (FK → `user`),
`createdAt`, `updatedAt`.

> **There is NO `score` column.** Severity and likelihood are stored
> independently; nothing computes or persists `severity × likelihood`. (The old
> cache claimed a `score` column and an auto-calc — both are wrong.)

PK is just `("id")` (single-column UUID), not the usual composite `(id, companyId)`.
Indexes: `companyId`, `assignee`, `itemId`, `status`, `source`, and `(type, companyId)`.

### Enums (title-cased — match exactly; old cache had wrong UPPER_SNAKE values)

- `riskSource`: `Customer`, `General`, `Item`, `Job`, `Quote Line`, `Supplier`,
  `Work Center`. (No `*_MASTER` variants — those never existed.)
- `riskStatus`: `Open`, `In Review`, `Mitigating`, `Closed`, `Accepted`.
- `riskRegisterType`: `Risk`, `Opportunity`.

Mirrored as `as const` arrays in `quality.models.ts` (`riskSource`, `riskStatus`,
`riskRegisterType`).

### `riskRegisters` view

`SECURITY_INVOKER=on`. Selects `riskRegister.*` plus `workCenterName`/`workCenterId`
via `LEFT JOIN "workCenter" wc ON r."sourceId" = wc."id"`. **`getRisks` (the list
query) reads this view; `getRisk` and the per-entity cards read the base
`riskRegister` table.**

### RLS

SELECT/INSERT → any company employee (`get_companies_with_employee_role()`).
UPDATE → `quality_update`; DELETE → `quality_delete`.

## Workflow & scoring

- Severity and likelihood are **two independent 1–5 ratings**, rendered by
  `RiskRating.tsx` as N colored bars (1–2 emerald, 3 yellow, 4 orange, 5 red).
  There is no combined score anywhere — UI shows the two ratings side by side.
- Status is a free-set enum (`Open` → `In Review` → `Mitigating` → `Closed`/`Accepted`);
  `updateRiskStatus(client, riskId, status)` patches it. No state-machine enforcement.
- New-risk action (`risks.new.tsx`) parses `severity`/`likelihood` from strings to
  ints, defaults `assignee` to the current user, and fires a `notify` job
  (`NotificationEvent.RiskAssignment`) when an assignee is set.

## Code map (verified)

- Service `apps/erp/app/modules/quality/quality.service.ts`: `getRisk`,
  `getRisks` (reads `riskRegisters` view, filters `status`/`source`/`assignee`,
  search on title/description, generic filters sorted `createdAt` desc),
  `upsertRisk` (id present → update + `updatedBy`/`updatedAt`; else insert — does
  NOT compute a score), `updateRiskStatus`, `deleteRisk`.
- Validators `quality.models.ts`: `riskRegisterValidator` (`severity`/`likelihood`
  are required **strings** min-1; `notes` parsed from JSON string; includes
  `itemId`, `sourceId`, `type`).
- UI `ui/RiskRegister/`: `RiskRegisterForm.tsx` (drawer form), `RiskRegistersTable.tsx`
  (global list), `RiskRegisterCard.tsx` (per-entity card, queries `riskRegister`
  filtered by `source` + `sourceId`), `RiskRating.tsx`, `RiskStatus.tsx`,
  `RiskType.tsx`.
- Routes `apps/erp/app/routes/x+/quality+/`: `risks.tsx` (list, `view: "quality"`),
  `risks.new.tsx` (action gated `role: "employee"` only — **not** `create: "quality"`),
  `risks.$id.tsx` (loader `view`, action `update: "quality"`),
  `risks.delete.$id.tsx` (`delete: "quality"`).
- Path helpers (`apps/erp/app/utils/path.ts`): `risks`, `risk(id)`, `newRisk`,
  `deleteRisk(id)`, plus `customerRisks(id)` / `supplierRisks(id)`.

## Entity integration

Per-entity cards wrap `RiskRegisterCard` with a fixed `source` and pass the entity id
as `sourceId`:
- Items → `ItemRiskRegister.tsx` (`source="Item"`, also passes `itemId`) — used on
  part/material/tool/consumable detail pages.
- Customer → `modules/sales/ui/Customer/CustomerRiskRegister.tsx` (`source="Customer"`),
  route `x+/customer+/$customerId.risks.tsx`.
- Supplier → `modules/purchasing/ui/Supplier/SupplierRiskRegister.tsx`
  (`source="Supplier"`), route `x+/supplier+/$supplierId.risks.tsx`.

Cards filter on `source` AND `sourceId`. Items additionally populate the dedicated
`itemId` FK column (in addition to `sourceId`). <!-- UNVERIFIED: no dedicated Job /
Quote Line / Work Center entity card found — those riskSource values exist in the
enum but only General/Item/Customer/Supplier appear to have wired-up UI entry points
(Work Center is surfaced only via the riskRegisters view join). -->

## Gotchas

- **No score.** Don't reintroduce a `score` column or a `severity × likelihood`
  calc — the design keeps the two ratings separate.
- **Enums are title-cased** (`Open`, `Item`, `Work Center`), not UPPER_SNAKE.
- `getRisks` reads the **`riskRegisters` view** (for `workCenterName`); single-row
  and per-entity reads use the **`riskRegister` table**. Keep that split in mind.
- `riskRegister` PK is a single UUID `id`, and the default is `gen_random_uuid()` —
  it deviates from the standard `id('prefix')` + composite-PK table template.
- Creating a risk only requires `role: "employee"`; editing/deleting require
  `quality_update`/`quality_delete`.
