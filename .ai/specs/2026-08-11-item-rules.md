# Item Rules — sales-document rule engine

- Status: **Finalized** (converted from approved PRD; all design questions resolved)
- Date: 2026-08-11
- Scope: Phase 1 (engine + table + admin UI + sales-line enforcement) + Phase 2 (notifications + acknowledgment log)

## Problem

Carbon cannot enforce commercial/compliance restrictions when an item is added to a quote or sales order (e.g. "if item type is X and customer location is Y → error"). Checks must resolve into **one combined error interface** — not stacked modals.

## Change summary — data model / API / UI

### Data model changes

- **New enum** `itemRuleSurface` = `'quoteLine' | 'salesOrderLine'` (deliberately separate from the storage `transactionSurface` enum).
- **New table `itemRule`** — rule definitions: `name`, `description`, `message` (token interpolation), `severity` (`error|warn`), `conditionAst` JSONB, `surfaces itemRuleSurface[]` (CHECK non-empty), item scoping (`filteredItemTypes`, `filteredItemGroupIds`, `filteredItemMatchAll`), `active`, audit columns, `customFields`. House PK `("id","companyId")`; RLS: SELECT any employee, writes `parts_*`. Registered in `customFieldTable` as `('itemRule','Item Rule','Items')`.
- **New table `itemRuleAssignment`** — explicit per-item pins, PK `(itemId, ruleId)`, composite FK to `itemRule`.
- **New table `itemRuleAcknowledgment`** — append-only override/block evidence: `ruleId`, `documentType 'quote'|'salesOrder'`, `documentId`, `documentLineId`, `itemId`, `severity`, `outcome 'blocked'|'acknowledged'`, `message`, `createdBy`. SELECT any employee; INSERT via `sales_create`; no UPDATE/DELETE policies.
- **New column** `companySettings.itemRuleNotificationGroup text[] NOT NULL DEFAULT '{}'` — the compliance-owner notification group.
- Migrations: `20260810214426_item-rules-sales.sql`, `20260810221652_item-rule-notification-group.sql`.

### API / server changes

- **`@carbon/utils`** (shared rule engine, additive): `RuleContext` gains a `customer` root; new `ITEM_RULE_SURFACES` / `ItemRuleSurface` / `RuleSurface`, `ItemRuleRow` + `compileItemRuleWithCache`, `ITEM_RULE_SURFACE_CONTEXT_AVAILABILITY`, `isFieldAvailableOnItemRuleSurfaces`, `getFieldsForItemRuleSurfaces`; field registry gains the `customer` context, a separate `ITEM_RULE_FIELD_REGISTRY` (customer type, customer status, ship-to country as alpha-2) + `getFieldsForItemRules`, synthesized `customer.customFields.*`, and `customerTypes|customerStatuses|countries` value-options loaders. Storage-rule behavior unchanged.
- **`@carbon/ee`** — new package exports `./item-rules` (client-safe: `getActiveItemRulesForItems`, `getItemRuleAssignmentsForItem`, `getItemRulesList`, `assignItemRule`, `unassignItemRule`, `buildItemRuleLineContext`) and `./item-rules.server` (`evaluateItemRuleLines`, `isItemRulesEnabledForCompany`, re-exported `isBlocked`/`dedupeViolations`). Evaluation runs with the service-role client, gated on the existing `ITEM_RULES` plan feature. Storage `LOADERS` upgraded so `{condition[n].name}` tokens resolve customer-type/status/country labels.
- **ERP** — new module `~/modules/item-rules` (`itemRuleValidator`, service CRUD + assignment counts); enforcement in four route actions (`quote` new/edit, `sales-order` new/edit) returning `{ violations, ruleNames }` when blocked, exactly like shipment posting; new routes `x+/items+/item-rules*` + assign/unassign; `path.to.itemRule*` helpers; `itemRulesQuery` cache key.
- **Notifications** — new `NotificationEvent.ItemRuleViolation` (topic Sales; in-app + email), notify fan-out branch resolving recipients from `itemRuleNotificationGroup`, fired on blocked attempts and acknowledged overrides; `updateItemRuleNotificationSetting` in the settings service. Acknowledgment rows inserted per deduped violation, never failing the action.
- No public REST surface changes beyond regenerated OpenAPI/types for the new tables.

### UI changes

- **Items sidebar → "Item Rules"** (Configure group): plan-gated list page with upgrade overlay, table (Name / Severity / Surfaces / Status / Items), create/edit drawer reusing the shared rule builder — surface picker (Quote line / Sales order line), condition builder with the customer fields (country picker saves alpha-2), severity select, message editor with tokens, item-type/group filters, custom fields.
- **Part detail → Inventory tab**: new "Item rules" card beneath the storage-rules card, listing explicit + broadcast rules with assign/unassign.
- **Quote & sales-order line forms**: submissions route through the shared violation hook; violations render in the **one combined modal** — errors block, warnings show "Acknowledge & continue".
- **Settings → Sales**: "Item Rule Violations" notification-group card.
- **Notifications**: in-app row (shield icon, links to the quote/order) and email for item-rule violations.

## Existing infrastructure (reuse, do not rebuild)

The storage-rules feature (born as `itemRule`, renamed via `customRule` → `storageRule`) is a generic predicate engine in three layers:

1. **Pure engine** — `packages/utils/src/storage-rules.ts` + `packages/utils/src/field-registry.ts`. `ConditionAst = {kind: all|any|none, conditions: [{field, op, value}]}`; operators `eq, neq, in, notIn, isSet, isNotSet, gt, lt`; `compileRule`/`compileWithCache` (LRU); `evaluateRules`; required-field semantics (`findFirstMissingRequiredField` emits "{label} is required" when a referenced field is empty); `interpolateMessage` `{token}` support; `itemRuleAppliesToItem` filter matcher; `SURFACE_CONTEXT_AVAILABILITY`.
2. **Server evaluator** — `packages/ee/src/storage-rules/server.ts`: `evaluateLinesForSurface()`, `isBlocked(violations, acknowledged)` (any `error` blocks; `warn` blocks until acknowledged), `dedupeViolations`. Context building in `context.ts` (`buildLineContext`). Plan gate `isStorageRulesEnabledForCompany`.
3. **Common error interface** — `packages/ee/src/storage-rules/violation-modal.tsx` (`StorageRuleViolationModal`: one modal, Errors + Warnings sections, confirm disabled on any error, "Acknowledge & continue" re-posts with `acknowledged=true`) + `use-violations.tsx` (`useStorageRuleViolations` hook wrapping useFetcher).

Reference enforcement wiring: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx:34-111` (read `acknowledged` → evaluate → dedupe → `isBlocked` → return `{violations, ruleNames}` on block).

Storage-rules admin module to clone: `apps/erp/app/modules/storage-rules/` (models with `.superRefine` surface/field cross-validation, service CRUD, `ui/RuleBuilder.tsx` + `ConditionRow` + `FieldCombobox`/`OperatorCombobox`/`ValueCombobox`/`ValueInput`/`MultiValueCombobox` + `SurfacesField` + `SeveritySelect` + `MessageWithTokens` + `ItemFilterSelector` + `RuleAssignmentsList`).

## Data Model Changes

Two migrations, all additive: `20260810214426_item-rules-sales.sql` and `20260810221652_item-rule-notification-group.sql`. `pnpm run generate:types` after.

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
  "ruleId" TEXT,
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

### `companySettings` (notification recipient group)

```sql
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "itemRuleNotificationGroup" text[] NOT NULL DEFAULT '{}';
```

## Engine extensions (`@carbon/utils`)

In `packages/utils/src/storage-rules.ts` (shared engine — extend, don't fork):
- Add surfaces `quoteLine`, `salesOrderLine` to the surface type + `SURFACE_CONTEXT_AVAILABILITY` (context roots available: `item`, `customer`, `transaction`).
- Add `customer` root to `RuleContext`: `{ id, typeId, statusId, location: { countryCode (alpha2) }, customFields }`.
- Field registry (`field-registry.ts`): add `customer.typeId` (options: customer types), `customer.statusId` (options: customer statuses), `customer.location.countryCode` (options: countries by alpha2 — matches app-wide convention since `20240928155702_country-codes.sql`; the `Country` selector already uses alpha2 values), plus synthesized `customer.customFields.*` mirroring `item.customFields.*`.

DB enum note: the DB-side `surfaces` uses the new `itemRuleSurface` enum — do NOT extend the storage `transactionSurface` enum (item rules have their own table).

## Evaluator (`packages/ee/src/item-rules/`)

Mirror `storage-rules/`: `service.ts` (cross-app queries: active rules for items incl. broadcasts + filters, assignments for target, list, assign/unassign), `server.ts` (**`evaluateItemRuleLines({ client, companyId, userId, surface, lines, customerId, customerLocationId })`** → `{ violations, ruleNames }` — the one canonical evaluator name, used by barrels and route actions alike; `userId` is required because the service-role client cannot infer the acting user, and it lands in `transaction.userId`; `isBlocked`/`dedupeViolations` re-exported from storage-rules, not duplicated), `context.ts` (build line context: item fields batch-loaded incl. `customFields` + flattened `itemPostingGroupId`, customer context resolved once per document — customer row with `customerTypeId`/`customerStatusId`/`customFields` + `customerLocation.addressId → address.countryCode` alpha2), `index.ts`. Package exports `./item-rules` and `./item-rules.server` in `packages/ee/package.json`.

**Rule selection contract:** every active `itemRule` is a broadcast; empty filters match all items; `filteredItemMatchAll` chooses OR (false) or AND (true) across the type/group dimensions; an explicit `itemRuleAssignment` bypasses the broadcast filters. Per line, assignments and broadcasts merge by `ruleId` before evaluation; violations are deduplicated by `ruleId` + message. A line whose item row fails to load matches explicit assignments only (mirrors the storage evaluator).

- Evaluation client: **service role** (`getCarbonServiceRole()`), same as storage rules; the route's `requirePermissions` remains the action gate.
- Plan gate: the **existing** `ITEM_RULES` feature key (`packages/ee/src/plan.ts:12` already defines it for Business/Partner — do not add a duplicate). Evaluation returns no violations when the gate is off (mirror `isStorageRulesEnabledForCompany`).
- Missing ship-to: rules referencing `customer.location.countryCode` rely on the engine's required-field semantics — empty → "Customer location is required" violation inheriting rule severity.
- Violation UI: **reuse** `useStorageRuleViolations` + `StorageRuleViolationModal` from `@carbon/ee/storage-rules` (they are generic over `Violation`); do not fork.

## ERP module (`apps/erp/app/modules/item-rules/`)

- `item-rules.models.ts` — `itemRuleValidator` (clone storageRule validator minus targetType/workCenter/appliesToAll; surfaces restricted to the two sales surfaces; same `.superRefine` field-availability check), `itemRuleAssignmentValidator`, `itemRuleAcknowledgeValidator`.
- `item-rules.service.ts` — `getItemRules` (paginated), `getItemRule`, `upsertItemRule`, `deleteItemRule`, `getItemRuleAssignmentCounts`; re-export ee cross-app fns via `index.ts` barrel.
- `ui/` — `ItemRuleForm.tsx` (ModalDrawer + ValidatedForm; reuse RuleBuilder/ConditionRow/SurfacesField/SeveritySelect/MessageWithTokens/ItemFilterSelector from storage-rules module or extract-shared), `ItemRulesTable.tsx` (Name/Severity/Surfaces/Status/Items columns), upgrade overlay via `usePlanGate`.
- Reuse strategy: import the builder components from `~/modules/storage-rules` directly (they are props-driven); only fork where storage-specific assumptions exist (surface list, field availability). Prefer parameterizing over copying.

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
- Client: `QuoteLineForm` / `SalesOrderLineForm` submit via `useStorageRuleViolations({ action })`, render `<rules.ViolationModal/>`. Coexists with the inline supersession notice (unchanged) and ConfiguratorModal.

## Notifications + acknowledgment log (Phase 2)

- `packages/notifications`: new `NotificationEvent` (e.g. `ItemRuleViolation`) + topic assignment; default destinations InApp (+Email optional).
- `packages/jobs` notify handler: handle the event (recipients from company setting group; payload rule name, severity, document type/id/line, item, customer, acting user, outcome `blocked|acknowledged`). Fire via `trigger("notify", …)` from the enforcement actions AFTER the outcome is known (blocked attempt, or acknowledged proceed).
- **Notification scope & idempotency (decided):** one notification per enforcement-action outcome — a repeated blocked attempt re-notifies deliberately (repeat attempts are signal for compliance, not noise); no cross-attempt dedup key in v1. Violations within one action are already deduplicated (`ruleId` + message) before the single notify fires. Delivery retries follow the existing notify function's semantics; a durable per-document dedup/idempotency key is a recorded follow-up, not v1.
- Settings: `itemRuleNotificationGroup` in `apps/erp/app/modules/settings/settings.models.ts` + settings UI where the other `*NotificationGroup` fields live.
- **Acknowledgment persistence (both outcomes):** insert `itemRuleAcknowledgment` rows — one per deduped violation — on **blocked** returns (`outcome: 'blocked'`; no document line exists, `documentLineId` stays null) and on **acknowledged** proceeds (`outcome: 'acknowledged'`). On create actions the acknowledged-path insert runs after the line write so `documentLineId` captures the new line's id; edit actions pass the route's `lineId`. `itemId` is set whenever the line references an item (item-less lines skip evaluation, so in practice it is always set).
- **Evidence atomicity (decided):** best-effort, never blocking — a blocked return writes only evidence (no line write, so no atomicity concern); on acknowledged proceeds an evidence-insert failure is logged and the sale proceeds (the business action must never fail because the audit write did). Duplicate evidence rows from client retries are acceptable in an append-only table (timestamps + actor disambiguate); a unique idempotency constraint is a recorded follow-up.

## Also in scope

- Fix stale `packages/utils/AGENTS.md` line describing `storage-rules.ts` as "Supabase storage bucket access policies" → it is the rule-evaluation engine.
- Update `apps/erp/app/modules/items/AGENTS.md` (new sibling feature) or create `modules/item-rules/AGENTS.md`.
- Unit tests: context building (customer root, alpha2 country), field-registry additions, evaluator happy-path + required-field (missing ship-to) + acknowledged flow. Mirror `packages/ee/src/storage-rules/context.test.ts`.

## Out of scope (explicitly)

Line-value (price/qty/date) context; purchasing surfaces / AVL; supersession fold-in; export-licence entity; MES surfaces. Configurator rules and storage rules untouched except shared-component parameterization.

## Verification

- `pnpm db:migrate` (apply locally; **flag to user first** — workspace has pre-existing generated-type modifications to investigate) → `pnpm run generate:types` → scoped typechecks: `pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/ee --filter=@carbon/erp --filter=@carbon/database`
- `pnpm --filter @carbon/utils test`, `pnpm --filter @carbon/ee test` (if test script exists), targeted vitest for new tests
- `pnpm run lint`
- No commits — working tree only, per standing instruction.
