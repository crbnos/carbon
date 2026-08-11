# Item Rules — sales-document rule engine

- Status: **Finalized** (converted from approved PRD; all design questions resolved)
- Date: 2026-08-11
- Scope: Phase 1 (engine + table + admin UI + sales-line enforcement) + Phase 2 (notifications + acknowledgment log)

## Problem

Carbon cannot enforce commercial/compliance restrictions when an item is added to a quote or sales order (e.g. "if item type is X and customer location is Y → error"). Checks must resolve into **one combined error interface** — not stacked modals.

## Change summary — data model / API / UI

### Data model changes

- **New enum** `itemRuleSurface` = `'quoteLine' | 'salesOrderLine'` (deliberately separate from the storage `transactionSurface` enum).
- **New table** `itemRule` — rule definitions: `name`, `description`, `message` (token interpolation), `severity` (`error|warn`), `conditionAst` JSONB, `surfaces itemRuleSurface[]` (CHECK non-empty), item scoping (`filteredItemTypes`, `filteredItemGroupIds`, `filteredItemMatchAll`), `active`, audit columns, `customFields`. House PK `("id","companyId")`; RLS: SELECT any employee, writes `parts_`*. Registered in `customFieldTable` as `('itemRule','Item Rule','Items')`.
- **New table** `itemRuleAssignment` — explicit per-item pins, PK `(itemId, ruleId)`, composite FK to `itemRule`.
- **New table** `itemRuleAcknowledgment` — append-only override/block evidence: `ruleId` (soft reference, no FK) + denormalized `ruleName`, `documentType 'quote'|'salesOrder'`, `documentId`, `documentLineId`, `itemId`, `severity`, `outcome 'blocked'|'acknowledged'`, `message`, `createdBy`. SELECT any employee; INSERT via `sales_create`; no UPDATE/DELETE policies. Evidence survives rule rename/deletion.
- **New column** `companySettings.itemRuleNotificationGroup text[] NOT NULL DEFAULT '{}'` — the compliance-owner notification group.
- Migrations: `20260810214426_item-rules-sales.sql`, `20260810221652_item-rule-notification-group.sql`, `20260810223831_item-rule-acknowledgment-rule-name.sql`.



### API / server changes

- `@carbon/utils` (shared rule engine, additive): `RuleContext` gains a `customer` root; new `ITEM_RULE_SURFACES` / `ItemRuleSurface` / `RuleSurface`, `ItemRuleRow` + `compileItemRuleWithCache`, `ITEM_RULE_SURFACE_CONTEXT_AVAILABILITY`, `isFieldAvailableOnItemRuleSurfaces`, `getFieldsForItemRuleSurfaces`; field registry gains the `customer` context, a separate `ITEM_RULE_FIELD_REGISTRY` (customer type, customer status, ship-to country as alpha-2) + `getFieldsForItemRules`, synthesized `customer.customFields.*`, and `customerTypes|customerStatuses|countries` value-options loaders. Storage-rule behavior unchanged.
- `@carbon/ee` — new package exports `./rules` (client-safe: `getActiveItemRulesForItems`, `getItemRuleAssignmentsForItem`, `getItemRulesList`, `assignItemRule`, `unassignItemRule`, `buildItemRuleLineContext`) and `./rules.server` (`evaluateItemRuleLines`, `isItemRulesEnabledForCompany`, re-exported `isBlocked`/`dedupeViolations`). Evaluation runs with the service-role client, gated on the existing `ITEM_RULES` plan feature. Storage `LOADERS` upgraded so `{condition[n].name}` tokens resolve customer-type/status/country labels.
- **ERP** — **no new module**: item rules lives inside `~/modules/items` (`itemRuleValidator` in `items.models.ts`, service CRUD + assignment counts in `items.service.ts`, UI under `modules/items/ui/ItemRules/`); enforcement in four route actions (`quote` new/edit, `sales-order` new/edit) returning `{ violations, ruleNames }` when blocked, exactly like shipment posting; new routes `x+/items+/item-rules`* + assign/unassign; `path.to.itemRule*` helpers; `itemRulesQuery` cache key.
- **Notifications** — new `NotificationEvent.ItemRuleViolation` (topic Sales; in-app + email), notify fan-out branch resolving recipients from `itemRuleNotificationGroup`, fired on blocked attempts and acknowledged overrides; `updateItemRuleNotificationSetting` in the settings service. Acknowledgment rows inserted per deduped violation, never failing the action.
- No public REST surface changes beyond regenerated OpenAPI/types for the new tables.
- **Follow-on refactor (shared-code unification + module placement):** item rules reuses the storage-rules engine, evaluator structure, and violation modal/hook instead of duplicating them; the shared code is therefore renamed from `storage-rules`* to neutral `rules` naming (`packages/utils/src/rules.ts`, `packages/ee/src/rules/{storage,item}`, exports `./rules` + `./rules.server`, `RuleViolationModal`/`useRuleViolations`). The same refactor folds the standalone `~/modules/storage-rules` ERP module into `~/modules/inventory` (its domain module), mirroring item rules living inside `~/modules/items`. Tables stay separate. Details in the "Follow-on refactor" section below.



### UI changes

- **Items sidebar → "Item Rules"** (Configure group): plan-gated list page with upgrade overlay, table (Name / Severity / Surfaces / Status / Items), create/edit drawer reusing the shared rule builder — surface picker (Quote line / Sales order line), condition builder with the customer fields (country picker saves alpha-2), severity select, message editor with tokens, item-type/group filters, custom fields.
- **Part detail → Inventory tab**: new "Item rules" card beneath the storage-rules card, listing explicit + broadcast rules with assign/unassign.
- **Quote & sales-order line forms**: submissions route through the shared violation hook; violations render in the **one combined modal** — errors block, warnings show "Acknowledge & continue".
- **Settings → Sales**: "Item Rule Violations" notification-group card.
- **Notifications**: in-app row (shield icon, links to the quote/order) and email for item-rule violations.



## Existing infrastructure (reuse, do not rebuild)

The storage-rules feature (born as `itemRule`, renamed via `customRule` → `storageRule`) is a generic predicate engine in three layers:

1. **Pure engine** — `packages/utils/src/rules.ts` (renamed from `storage-rules.ts`) + `packages/utils/src/field-registry.ts`. `ConditionAst = {kind: all|any|none, conditions: [{field, op, value}]}`; operators `eq, neq, in, notIn, isSet, isNotSet, gt, lt`; `compileRule`/`compileWithCache` (LRU); `evaluateRules`; required-field semantics (`findFirstMissingRequiredField` emits "{label} is required" when a referenced field is empty); `interpolateMessage` `{token}` support; `itemRuleAppliesToItem` filter matcher; `SURFACE_CONTEXT_AVAILABILITY`.
2. **Server evaluator** — `packages/ee/src/rules/storage/server.ts`: `evaluateLinesForSurface()`, `isBlocked(violations, acknowledged)` (any `error` blocks; `warn` blocks until acknowledged), `dedupeViolations`. Context building in `context.ts` (`buildLineContext`). Plan gate `isStorageRulesEnabledForCompany`.
3. **Common error interface** — `packages/ee/src/rules/violation-modal.tsx` (`RuleViolationModal`: one modal, Errors + Warnings sections, confirm disabled on any error, "Acknowledge & continue" re-posts with `acknowledged=true`) + `use-violations.tsx` (`useRuleViolations` hook wrapping useFetcher).

Reference enforcement wiring: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx:34-111` (read `acknowledged` → evaluate → dedupe → `isBlocked` → return `{violations, ruleNames}` on block).

Storage-rules admin code to clone (today at `apps/erp/app/modules/storage-rules/`; the follow-on refactor folds it into `~/modules/inventory`): models with `.superRefine` surface/field cross-validation, service CRUD, `ui/RuleBuilder.tsx` + `ConditionRow` + `FieldCombobox`/`OperatorCombobox`/`ValueCombobox`/`ValueInput`/`MultiValueCombobox` + `SurfacesField` + `SeveritySelect` + `MessageWithTokens` + `ItemFilterSelector` + `RuleAssignmentsList`.

## Follow-on refactor — rules code-layer unification

Item rules does not get its own rule machinery — it **shares** the storage-rules code: the pure engine (AST compile/evaluate, field registry), the evaluator structure, and the one violation modal + hook. That leaves a naming problem: a sales feature importing from `storage-rules`-named files/exports misreads as a dependency on the storage *feature* rather than on a shared engine. So, once item rules lands as a sibling of storage rules, refactor the shared code under neutral `rules` naming ("Option A": unify the **code** layer, keep the **DB** layer separate). The paths throughout this spec already use the unified names (`rules.ts`, `rules/storage`, `rules/item`).

The same refactor fixes **module placement**: rule features are not their own ERP domains, so neither gets a standalone `~/modules/*` directory. Item rules is built inside `~/modules/items` from the start (see "ERP placement" below); storage rules — today a standalone `~/modules/storage-rules` — folds into `~/modules/inventory`, its domain module.

**Decision.** Keep the `storageRule`* and `itemRule*` tables separate — separate RLS surfaces are simpler to reason about, self-hosted instances run migrations unattended (a table merge is a risky data migration), and the two schemas are under divergence pressure (different surfaces, filters, evidence models). Unify only the code so the shared engine, evaluators, and violation UI live under one name. A table merge (Option B/B′) is deliberately deferred until a real cross-family requirement appears (e.g. one rule targeting both storage and sales surfaces).

**Scope** (all renames via `git mv`; symbols unchanged unless noted):

- `packages/utils/src/storage-rules.ts` → `packages/utils/src/rules.ts` (exported symbols unchanged).
- `packages/ee/src/storage-rules/` + `packages/ee/src/item-rules/` → `packages/ee/src/rules/{storage,item}/`, with the shared violation modal + hook hoisted to the `rules/` root.
- Package exports: `./rules` + `./rules.server` **replace** `./storage-rules(.server)` + `./item-rules(.server)` — no back-compat aliases.
- Component/hook renames: `StorageRuleViolationModal` → `RuleViolationModal`, `useStorageRuleViolations` → `useRuleViolations`.
- Full import sweep across ERP, MES, and packages — no residual old-path or old-name references may remain.
- Collision note: `isBlocked`/`dedupeViolations` are re-exported by both evaluator dirs; resolve with explicit named re-exports in `rules/server.ts` (single source, storage impl).
- **Fold `~/modules/storage-rules` into `~/modules/inventory`:** merge `storage-rules.models.ts` into `inventory.models.ts` and `storage-rules.service.ts` into `inventory.service.ts` (one models/service file per module — house convention), move `ui/` to `modules/inventory/ui/StorageRules/` (matching the sibling `ui/Receipts`, `ui/StorageUnits`, … layout), export through the inventory barrel, sweep `~/modules/storage-rules` imports to `~/modules/inventory`, delete the directory.
- Sync docs in the same change (utils/ee AGENTS.md, `modules/items`/`modules/inventory` AGENTS.md + affected `.claude/rules` files).

**Untouched:** tables, RLS policies, enums, plan feature keys (`STORAGE_RULES` / `ITEM_RULES`), routes and URL paths (`x+/inventory+/storage-rules*`, `x+/items+/item-rules*` — the fold moves code, not URLs).

**Verification:** scoped typechecks for `@carbon/utils`, `@carbon/ee`, `erp`, `mes`; `@carbon/utils` + `@carbon/ee` test suites; lint; grep for residual `storage-rules`/`item-rules` import paths, `~/modules/storage-rules` references, and old component/hook names returns nothing.

## Data Model Changes

Three migrations, all additive: `20260810214426_item-rules-sales.sql`, `20260810221652_item-rule-notification-group.sql`, `20260810223831_item-rule-acknowledgment-rule-name.sql`. `pnpm run generate:types` after.

### Enum

```sql
-- Deliberately separate from the storage "transactionSurface" enum
CREATE TYPE "itemRuleSurface" AS ENUM ('quoteLine', 'salesOrderLine');
```



### `itemRule` (rule definitions)

Clone of `storageRule`'s shape with deliberate divergences: house PK convention (`id()` + composite `("id","companyId")` — not storageRule's legacy `xid()` single-column PK) and `parts_*` RLS (Items module) instead of `inventory_*`.

```sql
CREATE TABLE "itemRule" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message" TEXT NOT NULL,                                    -- violation text, {token} interpolation
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "conditionAst" JSONB NOT NULL,                              -- {kind: all|any|none, conditions:[{field,op,value}]}
  "surfaces" "itemRuleSurface"[] NOT NULL DEFAULT ARRAY['quoteLine', 'salesOrderLine']::"itemRuleSurface"[],
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
  CONSTRAINT "itemRule_surfaces_nonempty" CHECK (array_length("surfaces", 1) >= 1)
);

ALTER TABLE "itemRule" ADD CONSTRAINT "itemRule_companyId_name_key" UNIQUE ("companyId", "name");
```

RLS: the standard four policies — `SELECT` via `get_companies_with_employee_role()`, `INSERT`/`UPDATE`/`DELETE` via `get_companies_with_employee_permission('parts_<action>')`. Registered in `customFieldTable` as `('itemRule', 'Item Rule', 'Items')`.

### `itemRuleAssignment` (explicit per-item pins)

```sql
CREATE TABLE "itemRuleAssignment" (
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "itemRuleAssignment_pkey" PRIMARY KEY ("itemId", "ruleId"),
  CONSTRAINT "itemRuleAssignment_rule_fkey" FOREIGN KEY ("ruleId", "companyId")
    REFERENCES "itemRule"("id", "companyId") ON DELETE CASCADE
);
```

RLS: `SELECT` any employee; writes `parts_*` (same shape as `itemRule`). Tenant matching: the rule side is enforced by the composite FK `(ruleId, companyId) → itemRule(id, companyId)`; `item.id` is globally unique (its FK is single-column by necessity), so item-side tenancy is enforced by the `companyId` column + RLS — the same invariant the original `itemRuleAssignment` table relied on.

### `itemRuleAcknowledgment` (append-only override/block evidence)

The improvement over storage rules, where an acknowledgment is only a transient form flag: one persisted row per deduped violation, on blocked attempts and acknowledged overrides.

```sql
CREATE TABLE "itemRuleAcknowledgment" (
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

**Rule deletion behavior (decided):** the item-rule delete route hard-deletes the rule; assignments cascade (composite FK), but **evidence is never touched** — `ruleId` on acknowledgments is a deliberate soft reference with *no* FK, so a rule delete can neither cascade evidence away (CASCADE) nor be blocked by it (RESTRICT). Evidence stays self-contained through the denormalized `ruleName` plus the verbatim violation `message` captured per row. The recommended lifecycle for retiring a rule that has fired is deactivation (`active = false`); deletion remains available without audit loss. (Rules carry no version column — the rendered message per row is the point-in-time record.)

### `companySettings` (notification recipient group)

```sql
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "itemRuleNotificationGroup" text[] NOT NULL DEFAULT '{}';
```



## Engine extensions (`@carbon/utils`)

In `packages/utils/src/rules.ts` (shared engine — extend, don't fork):

- Add surfaces `quoteLine`, `salesOrderLine` to the surface type + `SURFACE_CONTEXT_AVAILABILITY` (context roots available: `item`, `customer`, `transaction`).
- Add `customer` root to `RuleContext`: `{ id, typeId, statusId, location: { countryCode (alpha2) }, customFields }`.
- Field registry (`field-registry.ts`): add `customer.typeId` (options: customer types), `customer.statusId` (options: customer statuses), `customer.location.countryCode` (options: countries by alpha2 — matches app-wide convention since `20240928155702_country-codes.sql`; the `Country` selector already uses alpha2 values), plus synthesized `customer.customFields.*` mirroring `item.customFields.*`.

DB enum note: the DB-side `surfaces` uses the new `itemRuleSurface` enum — do NOT extend the storage `transactionSurface` enum (item rules have their own table).

## Evaluator (`packages/ee/src/rules/item/`)

Mirror `storage-rules/`: `service.ts` (cross-app queries: active rules for items incl. broadcasts + filters, assignments for target, list, assign/unassign), `server.ts` (`evaluateItemRuleLines({ client, companyId, userId, surface, lines, customerId, customerLocationId })` → `{ violations, ruleNames }` — the one canonical evaluator name, used by barrels and route actions alike; `userId` is required because the service-role client cannot infer the acting user, and it lands in `transaction.userId`; `isBlocked`/`dedupeViolations` re-exported from storage-rules, not duplicated), `context.ts` (build line context: item fields batch-loaded incl. `customFields` + flattened `itemPostingGroupId`, customer context resolved once per document — customer row with `customerTypeId`/`customerStatusId`/`customFields` + `customerLocation.addressId → address.countryCode` alpha2), `index.ts`. Consolidated ee package: `packages/ee/src/rules/` holds `storage/` + `item/` evaluator dirs with the shared violation modal + hook at the root; package exports are `./rules` and `./rules.server`.

**Rule selection contract:** every active `itemRule` is a broadcast; empty filters match all items; `filteredItemMatchAll` chooses OR (false) or AND (true) across the type/group dimensions; an explicit `itemRuleAssignment` bypasses the broadcast filters. Per line, assignments and broadcasts merge by `ruleId` before evaluation; violations are deduplicated by `ruleId` + message. A line whose item row fails to load matches explicit assignments only (mirrors the storage evaluator).

- Evaluation client: **service role** (`getCarbonServiceRole()`), same as storage rules; the route's `requirePermissions` remains the action gate.
- **Tenant isolation below the service-role boundary (required):** RLS is bypassed on this client, so every query the evaluator/service issues — rules, assignments, items, customer, customerLocation — carries an explicit `companyId` predicate (or joins through a company-scoped row). These predicates ARE the tenant isolation; a service-role query without one is a defect, not a style choice. Mirrors the storage evaluator.
- Plan gate: the **existing** `ITEM_RULES` feature key (`packages/ee/src/plan.ts:12` already defines it for Business/Partner — do not add a duplicate). Evaluation returns no violations when the gate is off (mirror `isStorageRulesEnabledForCompany`).
- Missing ship-to: rules referencing `customer.location.countryCode` rely on the engine's required-field semantics — empty → "Customer location is required" violation inheriting rule severity.
- Violation UI: **reuse** `useRuleViolations` + `RuleViolationModal` from `@carbon/ee/rules` (they are generic over `Violation`); do not fork.



## ERP placement (`~/modules/items` — no new module)

Item rules is Items-domain functionality, not its own domain — it lives inside the existing `items` module (one `{module}.models.ts` / `{module}.service.ts` per module; never a scattered sibling module):

- `items.models.ts` — add `itemRuleValidator` (clone storageRule validator minus targetType/workCenter/appliesToAll; surfaces restricted to the two sales surfaces; same `.superRefine` field-availability check), `itemRuleAssignmentValidator`, `itemRuleAcknowledgeValidator`.
- `items.service.ts` — add `getItemRules` (paginated), `getItemRule`, `upsertItemRule`, `deleteItemRule`, `getItemRuleAssignmentCounts`; re-export ee cross-app fns via the items `index.ts` barrel.
- `ui/ItemRules/` — new subdirectory beside `ui/Parts`, `ui/Materials`, …: `ItemRuleForm.tsx` (ModalDrawer + ValidatedForm; reuse RuleBuilder/ConditionRow/SurfacesField/SeveritySelect/MessageWithTokens/ItemFilterSelector — see reuse strategy), `ItemRulesTable.tsx` (Name/Severity/Surfaces/Status/Items columns), upgrade overlay via `usePlanGate`.
- Reuse strategy: import the props-driven builder components from the storage-rules UI (post-refactor home: `~/modules/inventory/ui/StorageRules/`, exported through the inventory barrel); only fork where storage-specific assumptions exist (surface list, field availability). Prefer parameterizing over copying.



## Routes & wiring

- `x+/items+/item-rules.tsx` (list, loader `view: "parts"`), `item-rules.new.tsx`, `item-rules.$id.tsx`, `item-rules.delete.$id.tsx`; assignment routes `item-rules.assign.$itemId.tsx` / `item-rules.unassign.$itemId.$ruleId.tsx`. Write routes: `requirePlan({ feature: "ITEM_RULES" })` + `create/update/delete: "parts"`.
- Path helpers in `apps/erp/app/utils/path.ts`: `itemRules`, `itemRule(id)`, `newItemRule`, `deleteItemRule(id)`, assignment paths. React-query key `itemRulesQuery` in `apps/erp/app/utils/react-query.ts`.
- Sidebar: "Item Rules" entry in the Items submodules hook (`useItemsSubmodules`).
- Per-item drawer: extend the existing per-item Rules drawer (`RuleAssignmentsList` usage on `$itemId.inventory.tsx` etc.) with an "Item rules" section listing itemRule assignments alongside storage rules. If low-risk parameterization isn't feasible, add a sibling list under the same drawer.
- Naming discipline: `itemRule*` prefixes everywhere; never bare `rule`; configurator (`configurationRule*`) and storage (`storageRule*`) untouched.



## Enforcement (Phase 1)

- `x+/quote+/$quoteId.new.tsx` — after validation, before `upsertQuoteLine`: read `acknowledged` from formData; `evaluateItemRuleLines(surface: 'quoteLine')` with the header's `customerId`/`customerLocationId`; on `isBlocked` → return `{ violations, ruleNames }`.
- `x+/sales-order+/$orderId.new.tsx` — same, before `upsertSalesOrderLine`, surface `salesOrderLine`.
- **Item-only guard:** lines without an `itemId` (e.g. `Comment` sales-order lines, whose create action clears `itemId`) skip evaluation entirely — the guard wraps only the evaluation block, never the action.
- Line **edit** actions (`$quoteId.$lineId.details.tsx`, `$orderId.$lineId.details.tsx`) — same evaluation so edits can't dodge rules.
- Client: `QuoteLineForm` / `SalesOrderLineForm` submit via `useRuleViolations({ action })`, render `<rules.ViolationModal/>`. Coexists with the inline supersession notice (unchanged) and ConfiguratorModal.



## Notifications + acknowledgment log (Phase 2)

- `packages/notifications`: new `NotificationEvent` (e.g. `ItemRuleViolation`) + topic assignment; default destinations InApp (+Email optional).
- `packages/jobs` notify handler: handle the event — recipients from the company setting group; **payload is the document summary only**: the compound document id (`<quote|salesOrder>:<documentId>:<blocked|acknowledged>`) plus the acting user; the handler resolves the document reference and customer name for rendering. No per-violation fields ride the notification (see the payload contract below — that detail lives in the acknowledgment rows). Fire via `trigger("notify", …)` from the enforcement actions AFTER the outcome is known (blocked attempt, or acknowledged proceed).
- **Notification scope & idempotency (decided):** one notification per enforcement-action outcome — a repeated blocked attempt re-notifies deliberately (repeat attempts are signal for compliance, not noise); no cross-attempt dedup key in v1. Violations within one action are already deduplicated (`ruleId` + message) before the single notify fires. Delivery retries follow the existing notify function's semantics; a durable per-document dedup/idempotency key is a recorded follow-up, not v1.
- **Multi-violation payload contract (decided):** the notification is a **document-level summary**, not a per-violation fan-out. The payload identifies the document via a compound id — `<quote|salesOrder>:<documentId>:<blocked|acknowledged>` (the JobOperation compound-id precedent; the notify payload's `documentType` field is a narrower DB enum and cannot carry quote/salesOrder) — and the rendered content summarizes document reference, customer, outcome, and actor, linking to the document. Per-violation detail (rule id, denormalized rule name, severity, message) is deliberately NOT in the notification: it lives in the `itemRuleAcknowledgment` rows written by the same action, one per violation — the notification is the pointer, the evidence table is the record.
- Settings: `itemRuleNotificationGroup` in `apps/erp/app/modules/settings/settings.models.ts` + settings UI where the other `*NotificationGroup` fields live.
- **Acknowledgment persistence (both outcomes):** insert `itemRuleAcknowledgment` rows — one per deduped violation — on **blocked** returns (`outcome: 'blocked'`; no document line exists, `documentLineId` stays null) and on **acknowledged** proceeds (`outcome: 'acknowledged'`). On create actions the acknowledged-path insert runs after the line write so `documentLineId` captures the new line's id; edit actions pass the route's `lineId`. `itemId` is set whenever the line references an item (item-less lines skip evaluation, so in practice it is always set).
- **Evidence atomicity (decided):** best-effort, never blocking — a blocked return writes only evidence (no line write, so no atomicity concern); on acknowledged proceeds an evidence-insert failure is logged and the sale proceeds (the business action must never fail because the audit write did). Duplicate evidence rows from client retries are acceptable in an append-only table (timestamps + actor disambiguate); a unique idempotency constraint is a recorded follow-up.



## Also in scope

- Fix stale `packages/utils/AGENTS.md` line describing `storage-rules.ts` as "Supabase storage bucket access policies" → it is the rule-evaluation engine.
- Update `apps/erp/app/modules/items/AGENTS.md` to cover item rules (tables, service functions, enforcement points) — no separate module AGENTS.md, since item rules is part of the items module.
- Unit tests: context building (customer root, alpha2 country), field-registry additions, evaluator happy-path + required-field (missing ship-to) + acknowledged flow. Mirror `packages/ee/src/rules/storage/context.test.ts`.



## Out of scope (explicitly)

Line-value (price/qty/date) context; purchasing surfaces / AVL; supersession fold-in; export-licence entity; MES surfaces. Configurator rules and storage rules untouched except shared-component parameterization.

## Verification

- `pnpm db:migrate` (apply locally; **flag to user first** — workspace has pre-existing generated-type modifications to investigate) → `pnpm run generate:types` → scoped typechecks: `pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/ee --filter=@carbon/erp --filter=@carbon/database`
- `pnpm --filter @carbon/utils test`, `pnpm --filter @carbon/ee test` (if test script exists), targeted vitest for new tests
- `pnpm run lint`
- No commits — working tree only, per standing instruction.

