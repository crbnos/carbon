# Sales Rules — sales-document rule engine

- Status: **Finalized** (converted from approved PRD; all design questions resolved)
- Date: 2026-08-11
- Scope: Phase 1 (engine + table + admin UI + sales-line enforcement) + Phase 2 (notifications + acknowledgment log) + Phase 3 (enforcement completeness — terminal gates, unbypassable hard errors, Phase 1 defect fixes)
- 2026-08-15 rename: **Item Rules → Sales Rules.** Tables/enum/column/plan key renamed (`salesRule`, `salesRuleAssignment`, `salesRuleAcknowledgment`, `salesRuleSurface`, `salesRuleNotificationGroup`, `SALES_RULES`), ERP code moved from `~/modules/items` to `~/modules/sales` (routes `x+/sales+/sales-rules*`, `sales_*` RLS + route permissions, Sales sidebar). Rationale: the name states the gated domain exactly as Storage Rules does, matches the customer-centric condition fields, and avoids recreating the retired storage-era `itemRule` name. Done pre-merge — the three migrations were rewritten in place; no rename migrations exist.

## Problem

Carbon cannot enforce commercial/compliance restrictions when an item is added to a quote or sales order (e.g. "if item type is X and customer location is Y → error"). Checks must resolve into **one combined error interface** — not stacked modals.

## Change summary — data model / API / UI

### Data model changes

- **New enum** `salesRuleSurface` = `'quoteLine' | 'salesOrderLine'` — deliberately separate from the storage `transactionSurface` enum: the two families fire on categorically different things (warehouse/MES transaction events vs sales-document lines), and a shared enum would let the DB accept a storage rule subscribed to `quoteLine` (a rule that silently never fires). See the rationale under "Engine extensions".
- **New table** `salesRule` — rule definitions: `name`, `description`, `message` (token interpolation), `severity` (`error|warn`), `conditionAst` JSONB, `surfaces salesRuleSurface[]` (CHECK non-empty), item scoping (`filteredItemTypes`, `filteredItemGroupIds`, `filteredItemMatchAll`), `active`, audit columns, `customFields`. House PK `("id","companyId")`; RLS: SELECT any employee, writes `sales_`*. Registered in `customFieldTable` as `('salesRule','Sales Rule','Sales')`.
- **New table** `salesRuleAssignment` — explicit per-item pins, PK `(itemId, ruleId)`, composite FK to `salesRule`.
- **New table** `salesRuleAcknowledgment` — append-only override/block evidence: `ruleId` (soft reference, no FK) + denormalized `ruleName`, `documentType 'quote'|'salesOrder'`, `documentId`, `documentLineId`, `itemId`, `severity`, `outcome 'blocked'|'acknowledged'`, `message`, `createdBy`. SELECT any employee; INSERT via `sales_create`; no UPDATE/DELETE policies. Evidence survives rule rename/deletion.
- **New column** `companySettings.salesRuleNotificationGroup text[] NOT NULL DEFAULT '{}'` — the compliance-owner notification group.
- Migrations: `20260810214426_sales-rules-sales.sql`, `20260810221652_sales-rule-notification-group.sql`, `20260810223831_sales-rule-acknowledgment-rule-name.sql`.



### API / server changes

- `@carbon/utils` (shared rule engine, additive): `RuleContext` gains a `customer` root; new `SALES_RULE_SURFACES` / `SalesRuleSurface` / `RuleSurface`, `SalesRuleRow` + `compileSalesRuleWithCache`, `SALES_RULE_SURFACE_CONTEXT_AVAILABILITY`, `isFieldAvailableOnSalesRuleSurfaces`, `getFieldsForSalesRuleSurfaces`; field registry gains the `customer` context, a separate `SALES_RULE_FIELD_REGISTRY` (customer type, customer status, ship-to country as alpha-2) + `getFieldsForSalesRules`, synthesized `customer.customFields.*`, and `customerTypes|customerStatuses|countries` value-options loaders. Storage-rule behavior unchanged.
- `@carbon/ee` — new package exports `./rules` (client-safe: `getActiveSalesRulesForItems`, `getSalesRuleAssignmentsForItem`, `getSalesRulesList`, `assignSalesRule`, `unassignSalesRule`, `buildSalesRuleLineContext`) and `./rules.server` (`evaluateSalesRuleLines`, `isSalesRulesEnabledForCompany`, re-exported `isBlocked`/`dedupeViolations`). Evaluation runs with the service-role client, gated on the existing `SALES_RULES` plan feature. Storage `LOADERS` upgraded so `{condition[n].name}` tokens resolve customer-type/status/country labels.
- **ERP** — **no new module**: sales rules lives inside `~/modules/sales` (`salesRuleValidator` in `sales.models.ts`, service CRUD + assignment counts in `sales.service.ts`, UI under `modules/sales/ui/SalesRules/`); enforcement in four route actions (`quote` new/edit, `sales-order` new/edit) returning `{ violations, ruleNames }` when blocked, exactly like shipment posting; new routes `x+/sales+/sales-rules`* + assign/unassign; `path.to.salesRule*` helpers; `salesRulesQuery` cache key.
- **Notifications** — new `NotificationEvent.SalesRuleViolation` (topic Sales; in-app + email), notify fan-out branch resolving recipients from `salesRuleNotificationGroup`, fired on blocked attempts and acknowledged overrides; `updateSalesRuleNotificationSetting` in the settings service. Acknowledgment rows inserted per deduped violation, never failing the action.
- No public REST surface changes beyond regenerated OpenAPI/types for the new tables.
- **Refactor (shared-code unification + module placement):** sales rules reuses the storage-rules engine, evaluator structure, and violation modal/hook instead of duplicating them; rename the shared code from `storage-rules`* to neutral `rules` naming (`packages/utils/src/rules.ts`, `packages/ee/src/rules/{storage,sales}`, exports `./rules` + `./rules.server`, `RuleViolationModal`/`useRuleViolations`). The same refactor folds the standalone `~/modules/storage-rules` ERP module into `~/modules/inventory` (its domain module), mirroring sales rules living inside `~/modules/sales`. Tables stay separate. Details in the "Refactor" section below.



### UI changes

- **Sales sidebar → "Sales Rules"** (Configure group): plan-gated list page with upgrade overlay, table (Name / Severity / Surfaces / Status / Items), create/edit drawer reusing the shared rule builder — surface picker (Quote line / Sales order line), condition builder with the customer fields (country picker saves alpha-2), severity select, message editor with tokens, item-type/group filters, custom fields.
- **Part detail → Inventory tab**: new "Sales rules" card beneath the storage-rules card, listing explicit + broadcast rules with assign/unassign.
- **Quote & sales-order line forms**: submissions route through the shared violation hook; violations render in the **one combined modal** — errors block, warnings show "Acknowledge & continue".
- **Settings → Sales**: "Sales Rule Violations" notification-group card.
- **Notifications**: in-app row (shield icon, links to the quote/order) and email for sales-rule violations.



## Existing infrastructure (reuse, do not rebuild)

The storage-rules feature (born as `itemRule`, renamed via `customRule` → `storageRule`) is a generic predicate engine in three layers:

1. **Pure engine** — `packages/utils/src/storage-rules.ts` (→ `rules.ts` after the refactor below) + `packages/utils/src/field-registry.ts`. `ConditionAst = {kind: all|any|none, conditions: [{field, op, value}]}`; operators `eq, neq, in, notIn, isSet, isNotSet, gt, lt`; `compileRule`/`compileWithCache` (LRU); `evaluateRules`; required-field semantics (`findFirstMissingRequiredField` emits "{label} is required" when a referenced field is empty); `interpolateMessage` `{token}` support; `salesRuleAppliesToItem` filter matcher; `SURFACE_CONTEXT_AVAILABILITY`.
2. **Server evaluator** — `packages/ee/src/storage-rules/server.ts` (→ `rules/storage/server.ts`): `evaluateLinesForSurface()`, `isBlocked(violations, acknowledged)` (any `error` blocks; `warn` blocks until acknowledged), `dedupeViolations`. Context building in `context.ts` (`buildLineContext`). Plan gate `isStorageRulesEnabledForCompany`.
3. **Common error interface** — `packages/ee/src/storage-rules/violation-modal.tsx` (`StorageRuleViolationModal` → `RuleViolationModal`: one modal, Errors + Warnings sections, confirm disabled on any error, "Acknowledge & continue" re-posts with `acknowledged=true`) + `use-violations.tsx` (`useStorageRuleViolations` → `useRuleViolations` hook wrapping useFetcher).

Reference enforcement wiring: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx:34-111` (read `acknowledged` → evaluate → dedupe → `isBlocked` → return `{violations, ruleNames}` on block).

Storage-rules admin code to clone — currently the standalone `apps/erp/app/modules/storage-rules/`, which the refactor below folds into `~/modules/inventory`: models with `.superRefine` surface/field cross-validation, service CRUD, `ui/RuleBuilder.tsx` + `ConditionRow` + `FieldCombobox`/`OperatorCombobox`/`ValueCombobox`/`ValueInput`/`MultiValueCombobox` + `SurfacesField` + `SeveritySelect` + `MessageWithTokens` + `ItemFilterSelector` + `RuleAssignmentsList`.

## Refactor — rules code-layer unification + module placement

Sales rules must not get its own rule machinery — it **shares** the storage-rules code: the pure engine (AST compile/evaluate, field registry), the evaluator structure, and the one violation modal + hook. That leaves a naming problem: a sales feature importing from `storage-rules`-named files/exports would misread as a dependency on the storage *feature* rather than on a shared engine. So restructure the shared code under neutral `rules` naming as part of this work ("Option A": unify the **code** layer, keep the **DB** layer separate). The rest of this spec is written against the target layout (`rules.ts`, `rules/storage`, `rules/item`).

The same restructuring fixes **module placement**: rule features are not their own ERP domains, so neither gets a standalone `~/modules/*` directory. Build sales rules inside `~/modules/sales` from the start (see "ERP placement" below); fold the existing standalone `~/modules/storage-rules` into `~/modules/inventory`, its domain module.

**Decision (SUPERSEDED 2026-08-15 — see below).** Keep the `storageRule`* and `salesRule*` tables separate — separate RLS surfaces are simpler to reason about, self-hosted instances run migrations unattended (a table merge is a risky data migration), and the two schemas are under divergence pressure. Unify only the code.

**Decision (2026-08-15, IMPLEMENTED).** Option B is done: the tables are merged into one `enforcementRule` table discriminated by `family` ('storage' | 'sales'), with `enforcementRuleItemAssignment` (shared by both families), `enforcementRuleWorkCenterAssignment` (storage only) and `enforcementRuleAcknowledgment`. Migrations `20260817143022_enforcement-rules-table.sql` + `20260817143512_migrate-rules-into-enforcement-rules.sql`. It was done pre-merge of the sales feature so production performs exactly ONE table transition (the shipped `storageRule` → merged), with the unshipped sales tables folded in at the same time.

What the merge costs, explicitly: the guarantee that a rule cannot subscribe to another family's surface moves from the column TYPE (two enums) to two CHECK constraints (`enforcementRule_storage_surfaces` / `enforcementRule_sales_surfaces`, plus `enforcementRule_sales_shape` pinning sales rows to `targetType='item'`, `appliesToAll=false`); one `enforcementRuleSurface` enum now grows along both axes; RLS becomes per-family OR-predicates (storage → `inventory_*`, sales → `sales_*`, item pins resolved through an EXISTS on the rule's family so each family keeps the permission its source table required); and both families share one `customFieldTable` registry row ('Rule'). Query-level isolation replaces structural isolation, so every read filters `family` and pinned rules are resolved against a family-filtered fetch instead of a PostgREST embed — locked by `packages/ee/src/rules/family-isolation.test.ts`.

**Scope** (all renames via `git mv`; symbols unchanged unless noted):

- `packages/utils/src/storage-rules.ts` → `packages/utils/src/rules.ts` (exported symbols unchanged).
- `packages/ee/src/storage-rules/` + `packages/ee/src/sales-rules/` → `packages/ee/src/rules/{storage,item}/`, with the shared violation modal + hook hoisted to the `rules/` root.
- Package exports: `./rules` + `./rules.server` **replace** `./storage-rules(.server)` + `./sales-rules(.server)` — no back-compat aliases.
- Component/hook renames: `StorageRuleViolationModal` → `RuleViolationModal`, `useStorageRuleViolations` → `useRuleViolations`.
- Full import sweep across ERP, MES, and packages — no residual old-path or old-name references may remain.
- Collision note: `isBlocked`/`dedupeViolations` are re-exported by both evaluator dirs; resolve with explicit named re-exports in `rules/server.ts` (single source, storage impl).
- **Fold `~/modules/storage-rules` into `~/modules/inventory`:** merge `storage-rules.models.ts` into `inventory.models.ts` and `storage-rules.service.ts` into `inventory.service.ts` (one models/service file per module — house convention), move `ui/` to `modules/inventory/ui/StorageRules/` (matching the sibling `ui/Receipts`, `ui/StorageUnits`, … layout), export through the inventory barrel, sweep `~/modules/storage-rules` imports to `~/modules/inventory`, delete the directory.
- Sync docs in the same change (utils/ee AGENTS.md, `modules/sales`/`modules/inventory` AGENTS.md + affected `.claude/rules` files).

**Untouched:** tables, RLS policies, enums, plan feature keys (`STORAGE_RULES` / `SALES_RULES`), routes and URL paths (`x+/inventory+/storage-rules*`, `x+/sales+/sales-rules*` — the fold moves code, not URLs).

**Verification:** scoped typechecks for `@carbon/utils`, `@carbon/ee`, `erp`, `mes`; `@carbon/utils` + `@carbon/ee` test suites; lint; grep for residual `storage-rules`/`sales-rules` import paths, `~/modules/storage-rules` references, and old component/hook names returns nothing.

## Data Model Changes

Three migrations, all additive: `20260810214426_sales-rules-sales.sql`, `20260810221652_sales-rule-notification-group.sql`, `20260810223831_sales-rule-acknowledgment-rule-name.sql`. `pnpm run generate:types` after.

### Enum

```sql
-- Deliberately separate from the storage "transactionSurface" enum
CREATE TYPE "salesRuleSurface" AS ENUM ('quoteLine', 'salesOrderLine');
```



### `salesRule` (rule definitions)

Clone of `storageRule`'s shape with deliberate divergences: house PK convention (`id()` + composite `("id","companyId")` — not storageRule's legacy `xid()` single-column PK) and `sales_*` RLS (Sales module) instead of `inventory_*`.

```sql
CREATE TABLE "salesRule" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message" TEXT NOT NULL,                                    -- violation text, {token} interpolation
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "conditionAst" JSONB NOT NULL,                              -- {kind: all|any|none, conditions:[{field,op,value}]}
  "surfaces" "salesRuleSurface"[] NOT NULL DEFAULT ARRAY['quoteLine', 'salesOrderLine']::"salesRuleSurface"[],
  "filteredItemTypes" TEXT[] NOT NULL DEFAULT '{}',           -- broadcast scoping (empty = all items)
  "filteredItemGroupIds" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemMatchAll" BOOLEAN NOT NULL DEFAULT FALSE,      -- false = OR, true = AND across the two dimensions
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "salesRule_surfaces_nonempty" CHECK (array_length("surfaces", 1) >= 1)
);

ALTER TABLE "salesRule" ADD CONSTRAINT "salesRule_companyId_name_key" UNIQUE ("companyId", "name");
```

RLS: the standard four policies — `SELECT` via `get_companies_with_employee_role()`, `INSERT`/`UPDATE`/`DELETE` via `get_companies_with_employee_permission('sales_<action>')`. Registered in `customFieldTable` as `('salesRule', 'Sales Rule', 'Sales')`.

### `salesRuleAssignment` (explicit per-item pins)

```sql
CREATE TABLE "salesRuleAssignment" (
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "salesRuleAssignment_pkey" PRIMARY KEY ("itemId", "ruleId"),
  CONSTRAINT "salesRuleAssignment_rule_fkey" FOREIGN KEY ("ruleId", "companyId")
    REFERENCES "salesRule"("id", "companyId") ON DELETE CASCADE
);
```

RLS: `SELECT` any employee; writes `sales_*` (same shape as `salesRule`). Tenant matching: the rule side is enforced by the composite FK `(ruleId, companyId) → salesRule(id, companyId)`; `item.id` is globally unique (its FK is single-column by necessity), so item-side tenancy is enforced by the `companyId` column + RLS — the same invariant the original `salesRuleAssignment` table relied on.

### `salesRuleAcknowledgment` (append-only override/block evidence)

The improvement over storage rules, where an acknowledgment is only a transient form flag: one persisted row per deduped violation, on blocked attempts and acknowledged overrides.

```sql
CREATE TABLE "salesRuleAcknowledgment" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "ruleId" TEXT,                                              -- deliberate SOFT reference (no FK) — see deletion behavior below
  "ruleName" TEXT,                                            -- denormalized at write time; evidence survives rule rename/deletion
  "documentType" TEXT NOT NULL CHECK ("documentType" IN ('quote', 'salesOrder')),
  "documentId" TEXT NOT NULL,
  "documentLineId" TEXT,                                      -- null on create-line evaluations
  "itemId" TEXT,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('blocked', 'acknowledged')),
  "message" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),                   -- audit-injection convention; stays NULL (append-only)

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
```

RLS: `SELECT` any employee; `INSERT` via `sales_create` (the acknowledgment is written by the sales action); **no UPDATE/DELETE policies** — append-only.

**Rule deletion behavior (decided):** the sales-rule delete route hard-deletes the rule; assignments cascade (composite FK), but **evidence is never touched** — `ruleId` on acknowledgments is a deliberate soft reference with *no* FK, so a rule delete can neither cascade evidence away (CASCADE) nor be blocked by it (RESTRICT). Evidence stays self-contained through the denormalized `ruleName` plus the verbatim violation `message` captured per row. The recommended lifecycle for retiring a rule that has fired is deactivation (`active = false`); deletion remains available without audit loss. (Rules carry no version column — the rendered message per row is the point-in-time record.)

### `companySettings` (notification recipient group)

```sql
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "salesRuleNotificationGroup" text[] NOT NULL DEFAULT '{}';
```



## Engine extensions (`@carbon/utils`)

In `packages/utils/src/rules.ts` (shared engine — extend, don't fork):

- Add surfaces `quoteLine`, `salesOrderLine` to the surface type + `SURFACE_CONTEXT_AVAILABILITY` (context roots available: `item`, `customer`, `transaction`).
- Add `customer` root to `RuleContext`: `{ id, typeId, statusId, location: { countryCode (alpha2) }, customFields }`.
- Field registry (`field-registry.ts`): add `customer.typeId` (options: customer types), `customer.statusId` (options: customer statuses), `customer.location.countryCode` (options: countries by alpha2 — matches app-wide convention since `20240928155702_country-codes.sql`; the `Country` selector already uses alpha2 values), plus synthesized `customer.customFields.*` mirroring `item.customFields.*`.

DB enum note: the DB-side `surfaces` uses the new `salesRuleSurface` enum — do NOT extend the storage `transactionSurface` enum. Rationale:

- **Illegal states unrepresentable:** `storageRule.surfaces` is typed `transactionSurface[]`; adding `quoteLine`/`salesOrderLine` there would let the DB accept a storage rule subscribed to a sales surface (and a sales rule to `pick`) — rules that silently never fire. Separate enums make the column type the guard; a shared enum would need CHECK constraints on both tables instead.
- **Postgres enums are append-only:** values can be added but never removed without a type-rebuild migration. `transactionSurface` grows along the warehouse/MES axis (5 → 11 values so far); `salesRuleSurface` will grow along the sales-document axis (e.g. a future `purchaseOrderLine`). One enum would couple both features' migrations forever.
- **Mirrors the Option A split:** separate DB layer, shared code layer. The sharing happens in TypeScript where it is cheap and safe — `RuleSurface = TransactionSurface | SalesRuleSurface` lets the one engine evaluate either family — while surfaces keep driving per-family concerns (field-availability maps, each form's surface picker) that must not blend.

## Evaluator (`packages/ee/src/rules/item/`)

Mirror `storage-rules/`: `service.ts` (cross-app queries: active rules for items incl. broadcasts + filters, assignments for target, list, assign/unassign), `server.ts` (`evaluateSalesRuleLines({ client, companyId, userId, surface, lines, customerId, customerLocationId })` → `{ violations, ruleNames }` — the one canonical evaluator name, used by barrels and route actions alike; `userId` is required because the service-role client cannot infer the acting user, and it lands in `transaction.userId`; `isBlocked`/`dedupeViolations` re-exported from storage-rules, not duplicated), `context.ts` (build line context: item fields batch-loaded incl. `customFields` + flattened `itemPostingGroupId`, customer context resolved once per document — customer row with `customerTypeId`/`customerStatusId`/`customFields` + `customerLocation.addressId → address.countryCode` alpha2), `index.ts`. Consolidate the ee package so `packages/ee/src/rules/` holds the `storage/` + `item/` evaluator dirs with the shared violation modal + hook at the root; package exports become `./rules` and `./rules.server`.

**Rule selection contract:** every active `salesRule` is a broadcast; empty filters match all items; `filteredItemMatchAll` chooses OR (false) or AND (true) across the type/group dimensions; an explicit `salesRuleAssignment` bypasses the broadcast filters. Per line, assignments and broadcasts merge by `ruleId` before evaluation; violations are deduplicated by `ruleId` + message. A line whose item row fails to load matches explicit assignments only (mirrors the storage evaluator).

- Evaluation client: **service role** (`getCarbonServiceRole()`), same as storage rules; the route's `requirePermissions` remains the action gate.
- **Tenant isolation below the service-role boundary (required):** RLS is bypassed on this client, so every query the evaluator/service issues — rules, assignments, items, customer, customerLocation — carries an explicit `companyId` predicate (or joins through a company-scoped row). These predicates ARE the tenant isolation; a service-role query without one is a defect, not a style choice. Mirrors the storage evaluator.
- Plan gate: the **existing** `SALES_RULES` feature key (`packages/ee/src/plan.ts:12` already defines it for Business/Partner — do not add a duplicate). Evaluation returns no violations when the gate is off (mirror `isStorageRulesEnabledForCompany`).
- Missing ship-to: rules referencing `customer.location.countryCode` rely on the engine's required-field semantics — empty → "Customer location is required" violation inheriting rule severity.
- Violation UI: **reuse** `useRuleViolations` + `RuleViolationModal` from `@carbon/ee/rules` (they are generic over `Violation`); do not fork.



## ERP placement (`~/modules/sales` — no new module)

Sales rules is Sales-domain functionality, not its own domain — it lives inside the existing `sales` module (one `{module}.models.ts` / `{module}.service.ts` per module; never a scattered sibling module):

- `sales.models.ts` — add `salesRuleValidator` (clone storageRule validator minus targetType/workCenter/appliesToAll; surfaces restricted to the two sales surfaces; same `.superRefine` field-availability check), `salesRuleAssignmentValidator`, `salesRuleAcknowledgeValidator`.
- `sales.service.ts` — add `getSalesRules` (paginated), `getSalesRule`, `upsertSalesRule`, `deleteSalesRule`, `getSalesRuleAssignmentCounts`; re-export ee cross-app fns via the sales `index.ts` barrel.
- `ui/SalesRules/` — new subdirectory beside `ui/Parts`, `ui/Materials`, …: `SalesRuleForm.tsx` (ModalDrawer + ValidatedForm; reuse RuleBuilder/ConditionRow/SurfacesField/SeveritySelect/MessageWithTokens/ItemFilterSelector — see reuse strategy), `SalesRulesTable.tsx` (Name/Severity/Surfaces/Status/Items columns), upgrade overlay via `usePlanGate`.
- Reuse strategy: import the props-driven builder components from the storage-rules UI (post-refactor home: `~/modules/inventory/ui/StorageRules/`, exported through the inventory barrel); only fork where storage-specific assumptions exist (surface list, field availability). Prefer parameterizing over copying.



## Routes & wiring

- `x+/sales+/sales-rules.tsx` (list, loader `view: "sales"`), `sales-rules.new.tsx`, `sales-rules.$id.tsx`, `sales-rules.delete.$id.tsx`; assignment routes `sales-rules.assign.$itemId.tsx` / `sales-rules.unassign.$itemId.$ruleId.tsx`. Write routes: `requirePlan({ feature: "SALES_RULES" })` + `create/update/delete: "sales"`.
- Path helpers in `apps/erp/app/utils/path.ts`: `salesRules`, `salesRule(id)`, `newSalesRule`, `deleteSalesRule(id)`, assignment paths. React-query key `salesRulesQuery` in `apps/erp/app/utils/react-query.ts`.
- Sidebar: "Sales Rules" entry in the Sales submodules hook (`useSalesSubmodules`).
- Per-item drawer: extend the existing per-item Rules drawer (`RuleAssignmentsList` usage on `$itemId.inventory.tsx` etc.) with an "Sales rules" section listing salesRule assignments alongside storage rules. If low-risk parameterization isn't feasible, add a sibling list under the same drawer.
- Naming discipline: `salesRule*` prefixes everywhere; never bare `rule`; configurator (`configurationRule*`) and storage (`storageRule*`) untouched.



## Enforcement (Phase 1)

- `x+/quote+/$quoteId.new.tsx` — after validation, before `upsertQuoteLine`: read `acknowledged` from formData; `evaluateSalesRuleLines(surface: 'quoteLine')` with the header's `customerId`/`customerLocationId`; on `isBlocked` → return `{ violations, ruleNames }`.
- `x+/sales-order+/$orderId.new.tsx` — same, before `upsertSalesOrderLine`, surface `salesOrderLine`.
- **Item-only guard:** lines without an `itemId` (e.g. `Comment` sales-order lines, whose create action clears `itemId`) skip evaluation entirely — the guard wraps only the evaluation block, never the action.
- Line **edit** actions (`$quoteId.$lineId.details.tsx`, `$orderId.$lineId.details.tsx`) — same evaluation so edits can't dodge rules.
- Client: `QuoteLineForm` / `SalesOrderLineForm` submit via `useRuleViolations({ action })`, render `<rules.ViolationModal/>`. Coexists with the inline supersession notice (unchanged) and ConfiguratorModal.



## Notifications + acknowledgment log (Phase 2)

- `packages/notifications`: new `NotificationEvent` (e.g. `SalesRuleViolation`) + topic assignment; default destinations InApp (+Email optional).
- `packages/jobs` notify handler: handle the event — recipients from the company setting group; **payload is the document summary only**: the compound document id (`<quote|salesOrder>:<documentId>:<blocked|acknowledged>`) plus the acting user; the handler resolves the document reference and customer name for rendering. No per-violation fields ride the notification (see the payload contract below — that detail lives in the acknowledgment rows). Fire via `trigger("notify", …)` from the enforcement actions AFTER the outcome is known (blocked attempt, or acknowledged proceed).
- **Notification scope & idempotency (decided):** one notification per enforcement-action outcome — a repeated blocked attempt re-notifies deliberately (repeat attempts are signal for compliance, not noise); no cross-attempt dedup key in v1. Violations within one action are already deduplicated (`ruleId` + message) before the single notify fires. Delivery retries follow the existing notify function's semantics; a durable per-document dedup/idempotency key is a recorded follow-up, not v1.
- **Multi-violation payload contract (decided):** the notification is a **document-level summary**, not a per-violation fan-out. The payload identifies the document via a compound id — `<quote|salesOrder>:<documentId>:<blocked|acknowledged>` (the JobOperation compound-id precedent; the notify payload's `documentType` field is a narrower DB enum and cannot carry quote/salesOrder) — and the rendered content summarizes document reference, customer, outcome, and actor, linking to the document. Per-violation detail (rule id, denormalized rule name, severity, message) is deliberately NOT in the notification: it lives in the `salesRuleAcknowledgment` rows written by the same action, one per violation — the notification is the pointer, the evidence table is the record.
- Settings: `salesRuleNotificationGroup` in `apps/erp/app/modules/settings/settings.models.ts` + settings UI where the other `*NotificationGroup` fields live.
- **Acknowledgment persistence (both outcomes):** insert `salesRuleAcknowledgment` rows — one per deduped violation — on **blocked** returns (`outcome: 'blocked'`; no document line exists, `documentLineId` stays null) and on **acknowledged** proceeds (`outcome: 'acknowledged'`). On create actions the acknowledged-path insert runs after the line write so `documentLineId` captures the new line's id; edit actions pass the route's `lineId`. `itemId` is set whenever the line references an item (item-less lines skip evaluation, so in practice it is always set).
- **Evidence atomicity (decided):** best-effort, never blocking — a blocked return writes only evidence (no line write, so no atomicity concern); on acknowledged proceeds an evidence-insert failure is logged and the sale proceeds (the business action must never fail because the audit write did). Duplicate evidence rows from client retries are acceptable in an append-only table (timestamps + actor disambiguate); a unique idempotency constraint is a recorded follow-up.



## Enforcement completeness (Phase 3)

Audit: `.ai/research/2026-08-12-sales-rules-enforcement-surface.md`.

Phase 1 puts the check in four route actions. That is the right place for *early feedback* and the wrong place for *the guarantee*: 14 entry points can put an `itemId` on a sales line, and three of them (direct PostgREST with an API key, `SECURITY DEFINER` RPCs, service-role paths like the unauthenticated digital-quote accept) execute no Carbon TypeScript at all. The MCP executor resolves any named export of `sales.service.ts` by name, so the very function the enforced route protects is reachable unprotected.

**Principle: a compliance control fails at the document, not the line.** Enforcement that is per-write must be exhaustive to be worth anything, and this write surface is provably non-exhaustible. Enforcement that is per-*gate* only has to cover the transitions, and a gate re-reads the whole document — so it catches lines from writers nobody instrumented, and catches staleness (rule authored later, ship-to changed, item attributes changed) for free.

### Terminal gates

Copy the shipped pattern from `x+/shipment+/$shipmentId.post.tsx:33-109` verbatim — service-role client, load **all** lines on the document, evaluate, `dedupeViolations`, `isBlocked(deduped, acknowledged)`, **return** `{ violations, ruleNames }`, client renders the existing `useRuleViolations` + `RuleViolationModal`. Already running at seven sites; no new infrastructure.

| Gate | Route | Note |
|---|---|---|
| Sales order confirm | `x+/sales-order+/$orderId.confirm.tsx` | cleanest — already returns objects rather than redirecting |
| Quote finalize / send | `x+/quote+/$quoteId.finalize.tsx` | add the returned-violations branch **before** the existing `throw redirect(...)` paths |
| Quote → order convert | `x+/quote+/$quoteId.convert.tsx` | gate **in the route, before** `convertQuoteToOrder` |
| RFQ → quote convert | `x+/sales-rfq+/$rfqId.convert.tsx` | same; evaluate the resulting quote lines' items |
| Shipment post | `x+/shipment+/$shipmentId.post.tsx` | last physical checkpoint; catches orders confirmed before a rule existed. Add sales-rule violations to the array the storage-rule loop already builds. First point a real shipped quantity exists |

Gating the two convert routes **in the route** is deliberate: it achieves the same protection as a Deno-side evaluator with none of the cost. The engine is portable, but the evaluator imports `companyHasPlan` → `@carbon/auth` (module-load `process.env`) → `react-router`, and CI runs zero `deno` invocations, so a Node/Deno divergence would be silent. Do not port the evaluator.

**`api+/sales.digital-quote.$id.tsx` is hard-block-on-error only** — there is no employee session, nobody may acknowledge, and internal compliance text must not reach the customer. Log and proceed on warns.

### Unbypassable hard errors

Move the **error-severity** half of the check into `upsertQuoteLine` (`sales.service.ts:3788`) and `upsertSalesOrderLine` (`:5528`) so the MCP surface is covered — an `error` violation throws. Warn handling stays in the route actions, where `acknowledged` and the modal live. Blocklist `sales_insertSalesOrderLines` in `apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools.ts`; it has no in-app caller, so nothing breaks.

### Defects to fix (Phase 1 bugs)

- **Drop-ship reads the wrong destination.** Evaluation passes `salesOrder.customerLocationId`, but a drop shipment's real ship-to is `salesOrderShipment.customerLocationId` (required when `dropShipment` is set, `sales.models.ts:757-776`). Resolve the effective ship-to — drop-ship location when present, else the header — before evaluating. Without this a country rule clears orders that ship to the restricted country.
- **`acknowledged` is spoofable.** It is read straight off client FormData with no server-side record that a violation was displayed, so a crafted first submit skips every `warn`. Errors are unaffected (they block unconditionally). Fix or accept explicitly.
- **Quote quantity is hardcoded to `1`**, so quantity rules cannot fire on quotes; the real quantity is first chosen at conversion. The convert gate is the natural place to evaluate it.
- **`salesRuleAcknowledgment` has six writers and no reader** — either surface it or note it as write-only audit.

### Supporting change

`Violation` (`packages/utils/src/rules.ts`) is `{ruleId, severity, message}` with no line reference. A document-level gate needs per-line attribution so the modal can group violations and deep-link to the offending line. Extend it and key the modal by line.

### Deliberately excluded

- **No nightly sweep.** Drafts are a scratchpad — users must be free to experiment, and the confirm gate catches it before it counts. Avoids a cron, a violation-state table, and notification-fatigue tuning.
- **No rule-impact preview** ("what does my new rule break?").
- **No invoice-post gate — known gap.** Services are `Non-Inventory` items that are never shipped, so a service-only order skips shipment and goes straight to `To Invoice` (`convert/index.ts:552-560`); shipment post never fires for it. Deferred until a rule needs to apply to a service, at which point invoice posting is the hook.
- **No Postgres trigger.** It could enforce only the error-severity subset (no warn/acknowledge, no interpolated messages), and plan gating has no DB precedent across 898 migrations while `CarbonEdition`/`STRIPE_BYPASS_COMPANY_IDS` are invisible to Postgres. A second evaluator in a second language that disagrees with the first is worse than a known gap. Revisit only if a real bypass survives the gates.
- **Standalone sales invoices** (`x+/sales-invoice+/new.tsx` has a no-source-document branch with item-bearing lines) reach revenue with no upstream document. Out of scope here; recorded as a follow-up.

## Also in scope

- Fix stale `packages/utils/AGENTS.md` line describing `storage-rules.ts` as "Supabase storage bucket access policies" → it is the rule-evaluation engine.
- Update `apps/erp/app/modules/sales/AGENTS.md` to cover sales rules (tables, service functions, enforcement points) — no separate module AGENTS.md, since sales rules is part of the sales module.
- Unit tests: context building (customer root, alpha2 country), field-registry additions, evaluator happy-path + required-field (missing ship-to) + acknowledged flow. Mirror `packages/ee/src/rules/storage/context.test.ts`.



## Out of scope (explicitly)

Line-value (price/qty/date) context; purchasing surfaces / AVL; supersession fold-in; export-licence entity; MES surfaces. Configurator rules and storage rules untouched except shared-component parameterization.

Deferred with reasons in "Enforcement completeness (Phase 3) → Deliberately excluded": nightly violation sweep, rule-impact preview, invoice-post gate for service-only orders, Postgres-trigger enforcement, standalone sales invoices.

## Verification

- `pnpm db:migrate` (apply locally; **flag to user first** — workspace has pre-existing generated-type modifications to investigate) → `pnpm run generate:types` → scoped typechecks: `pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/ee --filter=@carbon/erp --filter=@carbon/database`
- `pnpm --filter @carbon/utils test`, `pnpm --filter @carbon/ee test` (if test script exists), targeted vitest for new tests
- `pnpm run lint`
- No commits — working tree only, per standing instruction.

