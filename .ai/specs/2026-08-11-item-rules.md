# Item Rules — sales-document rule engine

- Status: **Finalized** (converted from approved PRD; all design questions resolved)
- Date: 2026-08-11
- Scope: Phase 1 (engine + table + admin UI + sales-line enforcement) + Phase 2 (notifications + acknowledgment log)

## Problem

Carbon cannot enforce commercial/compliance restrictions when an item is added to a quote or sales order (e.g. "if item type is X and customer location is Y → error"). Checks must resolve into **one combined error interface** — not stacked modals.

## Existing infrastructure (reuse, do not rebuild)

The storage-rules feature (born as `itemRule`, renamed via `customRule` → `storageRule`) is a generic predicate engine in three layers:

1. **Pure engine** — `packages/utils/src/storage-rules.ts` + `packages/utils/src/field-registry.ts`. `ConditionAst = {kind: all|any|none, conditions: [{field, op, value}]}`; operators `eq, neq, in, notIn, isSet, isNotSet, gt, lt`; `compileRule`/`compileWithCache` (LRU); `evaluateRules`; required-field semantics (`findFirstMissingRequiredField` emits "{label} is required" when a referenced field is empty); `interpolateMessage` `{token}` support; `itemRuleAppliesToItem` filter matcher; `SURFACE_CONTEXT_AVAILABILITY`.
2. **Server evaluator** — `packages/ee/src/storage-rules/server.ts`: `evaluateLinesForSurface()`, `isBlocked(violations, acknowledged)` (any `error` blocks; `warn` blocks until acknowledged), `dedupeViolations`. Context building in `context.ts` (`buildLineContext`). Plan gate `isStorageRulesEnabledForCompany`.
3. **Common error interface** — `packages/ee/src/storage-rules/violation-modal.tsx` (`StorageRuleViolationModal`: one modal, Errors + Warnings sections, confirm disabled on any error, "Acknowledge & continue" re-posts with `acknowledged=true`) + `use-violations.tsx` (`useStorageRuleViolations` hook wrapping useFetcher).

Reference enforcement wiring: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx:34-111` (read `acknowledged` → evaluate → dedupe → `isBlocked` → return `{violations, ruleNames}` on block).

Storage-rules admin module to clone: `apps/erp/app/modules/storage-rules/` (models with `.superRefine` surface/field cross-validation, service CRUD, `ui/RuleBuilder.tsx` + `ConditionRow` + `FieldCombobox`/`OperatorCombobox`/`ValueCombobox`/`ValueInput`/`MultiValueCombobox` + `SurfacesField` + `SeveritySelect` + `MessageWithTokens` + `ItemFilterSelector` + `RuleAssignmentsList`).

## Data model (new migration)

### `itemRule`
Clone of `storageRule` shape with deliberate divergences:
- `id TEXT NOT NULL DEFAULT id()`, composite PK `("id","companyId")` (house convention — NOT storageRule's legacy `xid()` single-col PK)
- `companyId` FK → company ON DELETE CASCADE
- `name` (unique per company), `description`, `message` (token interpolation), `severity` TEXT CHECK `('error','warn')`
- `conditionAst` JSONB NOT NULL
- `surfaces` — new enum `itemRuleSurface` values `('quoteLine','salesOrderLine')`, array, CHECK non-empty
- `filteredItemTypes TEXT[]`, `filteredItemGroupIds TEXT[]`, `filteredItemMatchAll BOOLEAN` (same scoping as storageRule)
- `active BOOLEAN DEFAULT TRUE`, audit columns (`createdBy` NOT NULL + `updatedBy` nullable, both FK `"user"(id)` inline), `customFields` JSONB
- Indexes: companyId, partial active, FK columns. Register in `customFieldTable` as `('itemRule','Item Rule')`.
- RLS: SELECT `get_companies_with_employee_role()`; INSERT/UPDATE/DELETE `get_companies_with_employee_permission('parts_<action>')`.

### `itemRuleAssignment`
PK `(itemId, ruleId)`; FKs to item / itemRule / company. SELECT any employee; writes `parts_*`.

### `itemRuleAcknowledgment` (Phase 2)
Persisted override evidence: `id` (id()), `companyId`, `ruleId`, `documentType` TEXT CHECK `('quote','salesOrder')`, `documentId`, `documentLineId` (nullable), `itemId` (nullable), `message`, `severity`, `createdBy` NOT NULL, `createdAt`, `updatedBy` nullable (required by audit-injection convention even on append-only tables). SELECT any employee; INSERT `parts_create`… actually INSERT should be permitted for anyone who can create sales lines — use `sales_create` for INSERT; no UPDATE/DELETE policies (append-only).

## Engine extensions (`@carbon/utils`)

In `packages/utils/src/storage-rules.ts` (shared engine — extend, don't fork):
- Add surfaces `quoteLine`, `salesOrderLine` to the surface type + `SURFACE_CONTEXT_AVAILABILITY` (context roots available: `item`, `customer`, `transaction`).
- Add `customer` root to `RuleContext`: `{ id, typeId, statusId, location: { countryCode (alpha2) }, customFields }`.
- Field registry (`field-registry.ts`): add `customer.typeId` (options: customer types), `customer.statusId` (options: customer statuses), `customer.location.countryCode` (options: countries by alpha2 — matches app-wide convention since `20240928155702_country-codes.sql`; the `Country` selector already uses alpha2 values), plus synthesized `customer.customFields.*` mirroring `item.customFields.*`.

DB enum note: the DB-side `surfaces` uses the new `itemRuleSurface` enum — do NOT extend the storage `transactionSurface` enum (item rules have their own table).

## Evaluator (`packages/ee/src/item-rules/`)

Mirror `storage-rules/`: `service.ts` (cross-app queries: active rules for items incl. broadcasts + filters, assignments for target, list, assign/unassign), `server.ts` (`evaluateItemRulesForLines({ client, companyId, surface, lines, customer })` → violations; reuse `isBlocked`/`dedupeViolations` from storage-rules or re-export), `context.ts` (build line context: item fields loaded batch, customer context resolved once per document — customer row + `customerLocation.addressId → address.countryCode` alpha2), `index.ts`. Package exports `./item-rules` and `./item-rules.server` in `packages/ee/package.json`.

- Evaluation client: **service role** (`getCarbonServiceRole()`), same as storage rules; the route's `requirePermissions` remains the action gate.
- Plan gate: new `ITEM_RULES` feature key in `packages/ee/src/plan.ts`, same plans as `STORAGE_RULES`. Evaluation returns no violations when gate off (mirror `isStorageRulesEnabledForCompany`).
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

- `x+/quote+/$quoteId.new.tsx` — after validation, before `upsertQuoteLine`: read `acknowledged` from formData; resolve customer context (quote → `quoteCustomerDetails.customerCountryCode` or `getCustomerLocation`); `evaluateItemRulesForLines(surface: 'quoteLine')`; on `isBlocked` → return `{ violations, ruleNames }`.
- `x+/sales-order+/$orderId.new.tsx` — same, before `upsertSalesOrderLine`, surface `salesOrderLine`; country via `getCustomerLocation(client, salesOrder.customerLocationId)`.
- Line **edit** actions (`$quoteId.$lineId.details.tsx`, `$orderId.$lineId.details.tsx`) — same evaluation so edits can't dodge rules.
- Client: `QuoteLineForm` / `SalesOrderLineForm` submit via `useStorageRuleViolations({ action })`, render `<rules.ViolationModal/>`. Coexists with the inline supersession notice (unchanged) and ConfiguratorModal.

## Notifications + acknowledgment log (Phase 2)

- `packages/notifications`: new `NotificationEvent` (e.g. `ItemRuleViolation`) + topic assignment; default destinations InApp (+Email optional).
- `packages/jobs` notify handler: handle the event (recipients from company setting group; payload rule name, severity, document type/id/line, item, customer, acting user, outcome `blocked|acknowledged`). Fire via `trigger("notify", …)` from the enforcement actions AFTER the outcome is known (blocked attempt, or acknowledged proceed). Dedupe per document+rule (skip duplicate notify if same rule+document already notified — acceptable v1: fire on each block/acknowledge action, not on re-render).
- Settings: `itemRuleNotificationGroup` in `apps/erp/app/modules/settings/settings.models.ts` + settings UI where the other `*NotificationGroup` fields live.
- Acknowledgment persistence: when a warn-only violation set is acknowledged and the action proceeds, insert `itemRuleAcknowledgment` rows (one per acknowledged violation) in the same action.

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
