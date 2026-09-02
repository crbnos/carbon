# Item Rules — implementation plan

**Spec:** .ai/specs/implemented/2026-08-11-item-rules.md
**Research:** (in-session; baked into spec §"Existing infrastructure")
**Branch:** cambridge-bom-feature-gap-audit (NO commits — user grants commit separately)

## Progress
- [x] Task 1: Resolve pre-existing generated-type modifications (diffs were regeneration noise; restored, then regenerated cleanly)
- [x] Task 2: Migration — itemRule / itemRuleAssignment / itemRuleAcknowledgment (20260810214426_item-rules-sales.sql; applied; types regenerated; @carbon/database typecheck green)
- [x] Task 3: Engine extensions in @carbon/utils (+ unit tests)
- [x] Task 4: Evaluator package packages/ee/src/item-rules (+ tests + exports)
- [x] Task 5: ERP module item-rules — models + service + barrel
- [x] Task 6: Value-options loaders (customerTypes, customerStatuses, countries)
- [x] Task 7: UI — ItemRuleForm + ItemRulesTable (parameterize shared builder components)
- [x] Task 8: Routes, path helpers, react-query key, Items sidebar
- [x] Task 9: Assignment routes + per-item drawer section
- [x] Task 10: Enforcement — quote line create/edit actions
- [x] Task 11: Enforcement — sales-order line create/edit actions
- [x] Task 12: Wire line forms through useStorageRuleViolations + ViolationModal
- [x] Task 13: Notifications (event + settings group + notify handler + triggers) — NOTE deviation: added migration 20260810221652_item-rule-notification-group.sql (companySettings."itemRuleNotificationGroup" text[]) because the plan omitted storage for the setting; applied locally
- [x] Task 14: Acknowledgment persistence in enforcement actions
- [x] Task 15: Docs — fix packages/utils/AGENTS.md, add module AGENTS.md (utils fix done earlier; modules/item-rules/AGENTS.md created)
- [x] Task 16: Final verification sweep — 6/6 package typechecks, utils 76 tests, ee 40 tests, lint green (NO commit of implementation)

## Dependencies
- Task 2 needs Task 1. Tasks 5–14 need Task 2 (generated types). Task 3 is independent of Task 2 (can run in parallel).
- Task 4 needs Task 3 (+ Task 2 types for its service queries).
- Task 7 needs Tasks 3, 5, 6. Task 8 needs 5, 7. Task 9 needs 5, 8.
- Tasks 10–11 need Task 4; Task 12 needs 10–11. Tasks 13–14 need 10–11.
- Task 15 independent (after 4). Task 16 last.

## Global constraints (every task)
- pnpm only. Never edit `packages/database/src/types.ts`, `swagger-docs-schema.ts`, or `functions/lib/types.ts` by hand.
- No commits, no pushes, no new git refs. No DB data writes (schema migration apply is the one sanctioned DB operation, Task 2).
- Never touch: configurator rules (`x+/part+/$itemId.rule*.tsx`, `configurationRule*`), storage-rules behavior (parameterize shared components additively — default behavior unchanged), MES app.
- Naming discipline: every new identifier uses the `itemRule` / `item-rules` prefix; no bare `rule` names.

---

## Task 1: Resolve pre-existing generated-type modifications

**Depends on:** none
**Files:**
- Inspect (do not edit): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. `git diff --stat packages/database/src/types.ts packages/database/src/swagger-docs-schema.ts packages/database/supabase/functions/lib/types.ts` and skim `git diff packages/database/src/types.ts | head -100`.
2. These are generated files modified in the working tree before this run. If the diff is regeneration noise/drift (formatting, tables from already-applied local migrations), restore pristine state: `git checkout -- packages/database/src/types.ts packages/database/src/swagger-docs-schema.ts packages/database/supabase/functions/lib/types.ts`.
3. If the diff contains schema content that does NOT correspond to any migration on this branch (unknown tables/columns), STOP and report — do not restore, do not proceed to Task 2.

**Verify:**
```bash
git status --porcelain packages/database/
# Expected: no output (clean) — or STOP-and-report was taken
```

**Out of scope:** any other modified file.

## Task 2: Migration — itemRule / itemRuleAssignment / itemRuleAcknowledgment

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_item-rules-sales.sql` (via `pnpm db:migrate:new item-rules-sales`)
- Copy from (precedent): `packages/database/supabase/migrations/20260507120000_item-rules.sql` (RLS shape), `20260609143732_document-template.sql` (house PK/audit template)

**Steps:**
1. `pnpm db:migrate:new item-rules-sales` (never hand-pick the timestamp; HHMMSS must not be `000000`).
2. Write exactly this SQL into the created file:

```sql
-- Item rules: predicate rules evaluated when items are added to sales
-- documents (quote / sales order lines). Distinct from storageRule (warehouse
-- surfaces) and configurationRule (product configurator).
CREATE TYPE "itemRuleSurface" AS ENUM ('quoteLine', 'salesOrderLine');

CREATE TABLE "itemRule" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message" TEXT NOT NULL,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "conditionAst" JSONB NOT NULL,
  "surfaces" "itemRuleSurface"[] NOT NULL DEFAULT ARRAY['quoteLine', 'salesOrderLine']::"itemRuleSurface"[],
  "filteredItemTypes" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemGroupIds" TEXT[] NOT NULL DEFAULT '{}',
  "filteredItemMatchAll" BOOLEAN NOT NULL DEFAULT FALSE,
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
CREATE INDEX "itemRule_companyId_idx" ON "itemRule" ("companyId");
CREATE INDEX "itemRule_createdBy_idx" ON "itemRule" ("createdBy");
CREATE INDEX "itemRule_companyId_active_partial_idx" ON "itemRule" ("companyId") WHERE "active" = TRUE;

ALTER TABLE "public"."itemRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemRule"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."itemRule"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."itemRule"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."itemRule"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

CREATE TABLE "itemRuleAssignment" (
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "itemRuleAssignment_pkey" PRIMARY KEY ("itemId", "ruleId"),
  CONSTRAINT "itemRuleAssignment_rule_fkey" FOREIGN KEY ("ruleId", "companyId") REFERENCES "itemRule"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX "itemRuleAssignment_itemId_idx" ON "itemRuleAssignment" ("itemId");
CREATE INDEX "itemRuleAssignment_ruleId_idx" ON "itemRuleAssignment" ("ruleId");
CREATE INDEX "itemRuleAssignment_companyId_idx" ON "itemRuleAssignment" ("companyId");
CREATE INDEX "itemRuleAssignment_createdBy_idx" ON "itemRuleAssignment" ("createdBy");

ALTER TABLE "public"."itemRuleAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemRuleAssignment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."itemRuleAssignment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."itemRuleAssignment"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."itemRuleAssignment"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('parts_delete'))::text[])
);

-- Persisted override evidence: one row per acknowledged warn violation (and
-- blocked error attempt), keyed to the document the user was editing.
CREATE TABLE "itemRuleAcknowledgment" (
  "id" TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "ruleId" TEXT,
  "documentType" TEXT NOT NULL CHECK ("documentType" IN ('quote', 'salesOrder')),
  "documentId" TEXT NOT NULL,
  "documentLineId" TEXT,
  "itemId" TEXT,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('error', 'warn')),
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('blocked', 'acknowledged')),
  "message" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "itemRuleAcknowledgment_companyId_idx" ON "itemRuleAcknowledgment" ("companyId");
CREATE INDEX "itemRuleAcknowledgment_ruleId_idx" ON "itemRuleAcknowledgment" ("ruleId");
CREATE INDEX "itemRuleAcknowledgment_document_idx" ON "itemRuleAcknowledgment" ("documentType", "documentId");
CREATE INDEX "itemRuleAcknowledgment_createdBy_idx" ON "itemRuleAcknowledgment" ("createdBy");

ALTER TABLE "public"."itemRuleAcknowledgment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemRuleAcknowledgment"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
-- Append-only: INSERT permitted to anyone who can create sales lines (the
-- acknowledgment is written by the sales action); no UPDATE/DELETE policies.
CREATE POLICY "INSERT" ON "public"."itemRuleAcknowledgment"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('itemRule', 'Item Rule', 'Items')
ON CONFLICT DO NOTHING;
```

3. Apply locally: `pnpm db:migrate` (this regenerates types + swagger). This is the sanctioned schema-apply step; it writes no data.
4. If the regenerated `packages/database/src/types.ts` diff contains changes UNRELATED to the three new tables/enum, STOP and report (local DB drift) — do not proceed.

**Verify:**
```bash
grep -c "itemRuleAcknowledgment\|itemRuleAssignment\|itemRule:" packages/database/src/types.ts
# Expected: >= 3 (all three tables present in generated types)
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** touching the `transactionSurface` enum, `storageRule*` tables, or any existing table.

## Task 3: Engine extensions in @carbon/utils

**Depends on:** none (parallel with Task 2)
**Files:**
- Modify: `packages/utils/src/storage-rules.ts`
- Modify: `packages/utils/src/field-registry.ts`
- Modify/Create test: locate existing engine tests via `ls packages/utils/src/*.test.ts`; add cases to the storage-rules test file (or create `packages/utils/src/item-rules.test.ts` beside it using the same vitest imports)

**Steps:**
1. `storage-rules.ts`:
   - Add `"customer"` to `ROOT_KEYS` (line ~161) and `customer?: Record<string, unknown> & { customFields?: Record<string, unknown>; location?: Record<string, unknown> }` to `RuleContext`.
   - Add after `TRANSACTION_SURFACES`:
     ```ts
     export const ITEM_RULE_SURFACES = ["quoteLine", "salesOrderLine"] as const;
     export type ItemRuleSurface = (typeof ITEM_RULE_SURFACES)[number];
     export type RuleSurface = TransactionSurface | ItemRuleSurface;
     ```
   - Widen ONLY these signatures from `TransactionSurface` to `RuleSurface`: `CompiledRule.surfaces`, `StorageRuleRow.surfaces` stays as-is; instead add:
     ```ts
     export type ItemRuleRow = {
       id: string;
       severity: Severity;
       message: string;
       conditionAst: ConditionAst;
       surfaces?: ItemRuleSurface[];
       updatedAt?: string | null;
       active?: boolean;
     };
     export const compileItemRuleWithCache = (row: ItemRuleRow): CompiledRule =>
       compileWithCache({
         ...row,
         targetType: "item",
         surfaces: (row.surfaces && row.surfaces.length > 0
           ? row.surfaces
           : [...ITEM_RULE_SURFACES]) as unknown as TransactionSurface[]
       });
     ```
     and change `evaluateRules`'s `surface` param type to `RuleSurface` plus `CompiledRule.surfaces` to `readonly RuleSurface[]` (compile paths unchanged — `.includes()` is type-safe with the union). If widening `CompiledRule.surfaces` breaks existing ee/module typechecks, prefer `readonly string[]` narrowing at the two comparison sites and record the deviation in the run record.
   - Add:
     ```ts
     export const ITEM_RULE_SURFACE_CONTEXT_AVAILABILITY: Record<ItemRuleSurface, readonly FieldContext[]> = {
       quoteLine: ["item", "customer", "transaction"],
       salesOrderLine: ["item", "customer", "transaction"]
     };
     export const isFieldAvailableOnItemRuleSurfaces = (def: FieldDef, surfaces: readonly ItemRuleSurface[]): boolean =>
       surfaces.length === 0 ||
       surfaces.every((s) => ITEM_RULE_SURFACE_CONTEXT_AVAILABILITY[s]?.includes(def.context));
     export const getFieldsForItemRuleSurfaces = (surfaces: readonly ItemRuleSurface[]): FieldDef[] =>
       getFieldsForItemRules().filter((f) => isFieldAvailableOnItemRuleSurfaces(f, surfaces));
     ```
     (`getFieldsForItemRules` comes from field-registry, next step.)
2. `field-registry.ts`:
   - Add `"customer"` to the `FieldContext` union; add `"customerTypes" | "customerStatuses" | "countries"` to `ValueOptionsLoader`.
   - Add a SEPARATE registry (do NOT add to `FIELD_REGISTRY` — storage builder must not see these):
     ```ts
     export const ITEM_RULE_FIELD_REGISTRY: FieldDef[] = [
       fields.database({ table: "customer", column: "customerTypeId", nullable: true, label: "Customer type", type: "id", operators: ID_OPS, context: "customer", targetType: "item", ctxKey: "customer", valueOptionsLoader: "customerTypes" }),
       fields.database({ table: "customer", column: "customerStatusId", nullable: true, label: "Customer status", type: "id", operators: ID_OPS, context: "customer", targetType: "item", ctxKey: "customer", valueOptionsLoader: "customerStatuses" }),
       fields.synthetic({ path: "customer.location.countryCode", derivedFrom: "Ship-to country (alpha-2) resolved from the document's customer location address.", nullable: true, label: "Customer country", type: "id", operators: ID_OPS, context: "customer", valueOptionsLoader: "countries", targetType: "item" })
     ];
     export const getFieldsForItemRules = (): FieldDef[] => [
       ...FIELD_REGISTRY.filter((f) => f.context === "item" || f.targetType === "shared"),
       ...ITEM_RULE_FIELD_REGISTRY
     ];
     ```
     Note: `customer.customTypeId` path must come out as `customer.customerTypeId` — the `fields.database` helper prefixes with `ctxKey ?? table`; `ctxKey: "customer"` and `table: "customer"` are equivalent here, keep `ctxKey` for clarity.
   - Extend `getFieldDef` to also check `ITEM_RULE_FIELD_REGISTRY` and synthesize `customer.customFields.*` exactly like `item.customFields.*` (context `"customer"`, label = suffix, description "Custom field on the customer record.").
3. Tests (vitest): add cases asserting (a) `buildResolver("customer.location.countryCode")` resolves from a ctx with `customer.location.countryCode = "IR"`; (b) `compileItemRuleWithCache` + `evaluateRules` fire a violation for `{kind:"all", conditions:[{field:"item.type",op:"eq",value:"Part"},{field:"customer.location.countryCode",op:"in",value:["IR","KP"]}]}` with matching ctx on surface `"quoteLine"`, and produce a `"Customer country is required"`-style required-field violation when `customer.location` is absent; (c) `getFieldsForItemRuleSurfaces(["quoteLine"])` includes the three customer fields and excludes `storageUnit.*` / `workCenter.*` fields; (d) `getFieldDef("customer.customFields.foo")` returns a def with context `"customer"`.

**Verify:**
```bash
pnpm --filter @carbon/utils test
# Expected: all tests pass incl. new item-rules cases
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: exit 0
```

**Out of scope:** changing operator semantics, storage `SURFACE_CONTEXT_AVAILABILITY`, `SURFACES_BY_TARGET_TYPE`, or any existing FIELD_REGISTRY entry.

## Task 4: Evaluator package packages/ee/src/item-rules

**Depends on:** Tasks 2, 3
**Files:**
- Create: `packages/ee/src/item-rules/context.ts`, `server.ts`, `service.ts`, `index.ts`, `context.test.ts`
- Modify: `packages/ee/package.json` — add exports `"./item-rules": "./src/item-rules/index.ts"` and `"./item-rules.server": "./src/item-rules/server.ts"` beside the storage-rules entries (lines 9–10)
- Copy from (precedent): `packages/ee/src/storage-rules/{context,server,service,index}.ts` + `context.test.ts`

**Steps:**
1. `context.ts` — pure assembly, mirroring storage version:
   ```ts
   export type ItemRuleLineInput = { lineId: string; itemId?: string | null; quantity: number };
   export type CustomerCtxInput = {
     id: string;
     customerTypeId?: string | null;
     customerStatusId?: string | null;
     customFields?: Record<string, unknown>;
     location?: { countryCode?: string | null } | null;
   };
   export const buildItemRuleLineContext = (args: {
     line: ItemRuleLineInput;
     surface: ItemRuleSurface;
     userId: string;
     item?: Record<string, unknown> & { customFields?: Record<string, unknown> };
     customer?: CustomerCtxInput;
   }): RuleContext
   ```
   Returns `{ item: line.itemId ? (args.item ?? { id: line.itemId }) : undefined, customer: args.customer ? { id, customerTypeId, customerStatusId, customFields, location: args.customer.location ?? undefined } : undefined, transaction: { kind: surface, quantity: line.quantity, userId } }`. IMPORTANT: when the customer has no resolvable location, set `location: undefined` (NOT `{}`) so `customer.location.countryCode` resolves undefined → required-field semantics fire.
2. `service.ts` — cross-app queries with `SupabaseClient<Database>` first arg:
   - `getActiveItemRulesForItems(client, companyId, itemIds: string[])` → loads (a) all active `itemRule` rows for the company, (b) `itemRuleAssignment` rows for `itemIds`. Returns `{ rules: ItemRuleRowDb[], assignmentsByItemId: Map<string, Set<string>> }` where a rule applies to an item iff it has an explicit assignment OR (`itemRuleAppliesToItem(item, toItemRuleFilter(rule))` — filter matching happens in server.ts where item rows exist).
   - `getItemRuleAssignmentsForItem(client, { itemId, companyId })` — merged explicit + broadcast list for the drawer, mirroring `getRuleAssignmentsForTarget` (`packages/ee/src/storage-rules/service.ts:205`).
   - `getItemRulesList(client, companyId)`, `assignItemRule(client, { itemId, ruleId, companyId, createdBy })`, `unassignItemRule(client, { itemId, ruleId, companyId })`.
3. `server.ts`:
   - `isItemRulesEnabledForCompany(client, companyId): Promise<boolean>` — copy `isStorageRulesEnabledForCompany` (`storage-rules/server.ts:45`) switching the feature key to `"ITEM_RULES"` (key already exists in `packages/ee/src/plan.ts:12`).
   - Re-export `isBlocked` and `dedupeViolations` from `../storage-rules/server` (do not duplicate).
   - `evaluateItemRuleLines(args: { client: SupabaseClient<Database>; companyId: string; userId: string; surface: ItemRuleSurface; lines: ItemRuleLineInput[]; customerId: string | null; customerLocationId: string | null }): Promise<{ violations: Violation[]; ruleNames: Record<string, string> }>`:
     a. Plan gate: return empty when `!(await isItemRulesEnabledForCompany(...))`.
     b. Load customer row (`customer` select `id, customerTypeId, customerStatusId, customFields` by id+companyId) and, when `customerLocationId` set, `customerLocation` select `id, address(countryCode)`; build `CustomerCtxInput` with `location: countryCode ? { countryCode } : undefined`.
     c. Batch-load items for `lines[].itemId`: select `id, readableIdWithRevision, name, type, replenishmentSystem, itemTrackingType, customFields, itemCost(itemPostingGroupId)`; flatten `itemPostingGroupId` via `itemPostingGroupIdFromEmbed` (import from `../storage-rules/context`).
     d. Load rules via `getActiveItemRulesForItems`; per line: applicable rules = explicit assignments ∪ broadcasts passing `itemRuleAppliesToItem`; compile with `compileItemRuleWithCache`; `evaluateRules(compiled, ctx, surface)`.
     e. `dedupeViolations` across lines; build `ruleNames` map (ruleId → rule.name).
4. `index.ts` — `export * from "./service"` + re-export the context types (client-safe only; server.ts NOT exported here).
5. `context.test.ts` — mirror the storage anti-drift test: assert the ctx built for each `ItemRuleSurface` populates exactly the contexts named in `ITEM_RULE_SURFACE_CONTEXT_AVAILABILITY` (item, customer, transaction), and that missing location yields `customer.location === undefined`.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: pass, incl. item-rules context tests
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** modifying storage-rules server/service beyond adding exports; touching plan.ts (key exists).

## Task 5: ERP module item-rules — models + service + barrel

**Depends on:** Task 2
**Files:**
- Create: `apps/erp/app/modules/item-rules/item-rules.models.ts`, `item-rules.service.ts`, `index.ts`
- Copy from (precedent): `apps/erp/app/modules/storage-rules/storage-rules.models.ts`, `storage-rules.service.ts`, `index.ts`

**Steps:**
1. `item-rules.models.ts` — clone the storage validator with these changes: drop `targetType` and `appliesToAll`; `surfaces: zfd.repeatableOfType(z.enum(ITEM_RULE_SURFACES)).refine(arr => arr.length >= 1, { message: "Pick at least one surface" })`; superRefine keeps ONLY the field-availability check, using `isFieldAvailableOnItemRuleSurfaces` (no targetType check needed). Export `itemRuleValidator`, `itemRuleAssignmentValidator = z.object({ itemId: z.string().min(1), ruleId: z.string().min(1) })`, `itemRuleSeverities = ["error","warn"] as const`.
2. `item-rules.service.ts` — mirror storage service exactly (`getStorageRules:52` → `getItemRules` filtering `itemRule` table; `getItemRule`, `upsertItemRule` (insert vs update branch on `createdBy`, cast `conditionAst` to `Json`), `deleteItemRule`, `getItemRuleAssignmentCounts` (single assignment table)).
3. `index.ts` barrel: `export * from "./item-rules.models"; export * from "./item-rules.service";` plus re-export from `@carbon/ee/item-rules`: `getActiveItemRulesForItems, getItemRuleAssignmentsForItem, getItemRulesList, assignItemRule, unassignItemRule`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0 (module compiles; not yet routed)
```

**Out of scope:** UI components (Task 7), routes (Task 8).

## Task 6: Value-options loaders

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/storage-rules/ui/useValueOptions.ts` — add `customerTypes`, `customerStatuses`, `countries` loader branches
- Inspect for existing API routes: `apps/erp/app/routes/api+/sales.customer-types.ts` (exists — precedent for clientLoader caching); check for a customer-statuses api route and the countries api route (`path.to.api.countries` exists, used by `~/components/Form/Country.tsx`)

**Steps:**
1. Read `useValueOptions.ts` to learn the loader-branch shape (each `ValueOptionsLoader` maps to a fetch/store returning `{label, value}[]`).
2. Add three branches: `customerTypes` (fetch `path.to.api.customerTypes` if it exists — grep `customer-types` in `path.ts`; options `{label: name, value: id}`), `customerStatuses` (same pattern; if no api route exists, create `apps/erp/app/routes/api+/sales.customer-statuses.ts` copying `sales.customer-types.ts` with `getCustomerStatuses` from `~/modules/sales`), `countries` (fetch `path.to.api.countries`; options `{label: name, value: alpha2}` — value MUST be alpha2, matching `~/components/Form/Country.tsx:31-34`).
3. If `useValueOptions.ts` is structured as a switch over loader names, keep additions additive; do not alter existing branches.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0
```

**Out of scope:** the `ValueCombobox` component internals.

## Task 7: UI — ItemRuleForm + ItemRulesTable

**Depends on:** Tasks 3, 5, 6
**Files:**
- Create: `apps/erp/app/modules/item-rules/ui/ItemRuleForm.tsx`, `ItemRulesTable.tsx`, `ui/index.ts`
- Modify (additive parameterization only): `apps/erp/app/modules/storage-rules/ui/RuleBuilder.tsx`, `SurfacesField.tsx` (and `ConditionRow.tsx`/`FieldCombobox.tsx` only if they hardcode targetType field lookups)
- Copy from (precedent): `apps/erp/app/modules/storage-rules/ui/StorageRuleForm.tsx`, `StorageRulesTable.tsx`

**Steps:**
1. Read `RuleBuilder.tsx` + `SurfacesField.tsx`. Where they derive the field list / surface list from `targetType`, add OPTIONAL props: `fields?: FieldDef[]` (RuleBuilder — when provided, use instead of the targetType lookup) and `surfaceOptions?: { value: string; label: string; }[]` (SurfacesField). Defaults preserve current storage behavior exactly.
2. `ItemRuleForm.tsx` — clone StorageRuleForm: ModalDrawer + ValidatedForm with `validator={itemRuleValidator}`, action `path.to.itemRule(id)` / `path.to.newItemRule`; fields: Input name + Boolean active, TextArea description, SeveritySelect (reuse from `~/modules/storage-rules/ui` — export it from that module's ui index if not already), `ItemFilterSelector` (reuse), `SurfacesField` with `surfaceOptions=[{value:"quoteLine",label:"Quote line"},{value:"salesOrderLine",label:"Sales order line"}]`, `RuleBuilder` with `fields={getFieldsForItemRuleSurfaces(liveSurfaces)}`, `MessageWithTokens` (reuse), `CustomFormFields table="itemRule"`.
3. `ItemRulesTable.tsx` — clone StorageRulesTable with columns Name / Severity / Surfaces / Status / Items (assignment count); permission checks use `parts`; row menu edit/delete via `path.to.itemRule(id)` / `path.to.deleteItemRule(id)`.
4. If a shared component turns out to be too storage-coupled for a small optional-prop change (e.g. deep targetType branching), fork it into `modules/item-rules/ui/` with the minimal copy and note the fork in the run record — do NOT restructure the storage component.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0
pnpm run lint
# Expected: exit 0 (or only pre-existing warnings)
```

**Out of scope:** StorageRuleForm behavior/визual changes; the `StorageRulesGroups` card layout (item rules use the table layout).

## Task 8: Routes, path helpers, react-query key, Items sidebar

**Depends on:** Tasks 5, 7
**Files:**
- Create: `apps/erp/app/routes/x+/items+/item-rules.tsx` (list), `item-rules.new.tsx`, `item-rules.$id.tsx`, `item-rules.$id.delete.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `itemRules: `${x}/items/item-rules``, `newItemRule`, `itemRule(id)`, `deleteItemRule(id)`, `itemRuleAssign(itemId)`, `itemRuleUnassign(itemId, ruleId)` in alphabetical position near the other `itemR*` helpers
- Modify: `apps/erp/app/utils/react-query.ts` — add `itemRulesQuery` cloning `storageRulesQuery` (line 188)
- Modify: `apps/erp/app/modules/items/ui/useItemsSubmodules.tsx` — add an "Item Rules" entry (`name: t\`Item Rules\``, `to: path.to.itemRules`) in the appropriate group
- Copy from (precedent): `apps/erp/app/routes/x+/inventory+/storage-rules.tsx`, `storage-rules.new.tsx`, `storage-rules.$id.tsx`, `storage-rules.$id.delete.tsx`

**Steps:**
1. Clone each storage-rules route file, swapping: module imports → `~/modules/item-rules`, permissions `inventory` → `parts`, plan gate `requirePlan({ feature: "ITEM_RULES", ... })` in new/`$id`/delete actions (copy the exact `requirePlan` usage from the storage new route), paths → item-rule helpers, list component → `ItemRulesTable`, and the upgrade overlay via `usePlanGate` with feature `ITEM_RULES`.
2. Breadcrumb `handle.breadcrumb: msg\`Item Rules\`` matching neighboring items routes.
3. Keep `clientAction` cache invalidation using `itemRulesQuery(getCompanyId()).queryKey` in mutating routes, mirroring storage routes.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0
grep -n "itemRules" apps/erp/app/utils/path.ts
# Expected: the six new helpers
```

**Out of scope:** renaming or touching `$itemId.rule.tsx` (configurator).

## Task 9: Assignment routes + per-item drawer section

**Depends on:** Tasks 5, 8
**Files:**
- Create: `apps/erp/app/routes/x+/items+/item-rules.assign.$itemId.tsx`, `item-rules.unassign.$itemId.$ruleId.tsx`
- Modify: the per-item Rules drawer usage — read `apps/erp/app/modules/storage-rules/ui/RuleAssignmentsList.tsx` and its mount in `apps/erp/app/routes/x+/part+/$itemId.inventory.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/items+/rules.assign.$itemId.tsx`, `rules.unassign.$itemId.$ruleId.tsx` (storage-rule item assignment routes)

**Steps:**
1. Clone the two storage assignment routes → item-rule equivalents calling `assignItemRule` / `unassignItemRule`, permission `update: "parts"`, plan gate `ITEM_RULES`.
2. Parameterize `RuleAssignmentsList` with optional props (`title?`, data-loader results + assign/unassign action paths passed in) OR render a second instance: in `$itemId.inventory.tsx`, load `getItemRuleAssignmentsForItem` alongside the existing storage call and render an "Item rules" section beneath the storage one in the same drawer. Choose the smaller diff; keep storage behavior identical.
3. If the drawer is mounted in multiple item-type routes (`tool+`, `material+`, `consumable+` `$itemId.inventory.tsx`), apply the same change ONLY to `part+` in this task and note the others as follow-up in the run record (parts are the sales-relevant type).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0
```

**Out of scope:** the other item-type inventory routes (recorded follow-up).

## Task 10: Enforcement — quote line create/edit

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/routes/x+/quote+/$quoteId.new.tsx` — after validation, before `upsertQuoteLine` (~line 64)
- Modify: `apps/erp/app/routes/x+/quote+/$quoteId.$lineId.details.tsx` — same evaluation in its update action
- Copy from (precedent): `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx:34-111` (acknowledged → evaluate → dedupe → isBlocked → return violations)

**Steps:**
1. In each action, after `validator(...)` success: read `const acknowledged = formData.get("acknowledged") === "true"`.
2. Load the quote header (already loaded or via `getQuote`) for `customerId` + `customerLocationId`.
3. `const serviceRole = getCarbonServiceRole();` then:
   ```ts
   const { violations, ruleNames } = await evaluateItemRuleLines({
     client: serviceRole, companyId, userId, surface: "quoteLine",
     lines: [{ lineId: id ?? "new", itemId: validation.data.itemId ?? null, quantity: validation.data.quantity ?? 1 }],
     customerId: quote.customerId, customerLocationId: quote.customerLocationId ?? null
   });
   const deduped = dedupeViolations(violations);
   if (isBlocked(deduped, acknowledged)) {
     return { error: null, data: null, violations: deduped, ruleNames };
   }
   ```
   Import from `@carbon/ee/item-rules.server`. Match the exact return shape the shipment post route uses so `useStorageRuleViolations` picks it up.
4. Escape hatch: if the quote line validator has no single `quantity` field (quotes may have quantity arrays), use `1` as the transaction quantity and note it — quantity rules are out of scope for quotes v1.
5. Do not alter the success path (redirect/method resolution) otherwise.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0
```

**Out of scope:** configurator flow branches in the quote action; pricing logic.

## Task 11: Enforcement — sales-order line create/edit

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/routes/x+/sales-order+/$orderId.new.tsx` (before `upsertSalesOrderLine`, ~line 65)
- Modify: `apps/erp/app/routes/x+/sales-order+/$orderId.$lineId.details.tsx` (update action)
- Copy from (precedent): same as Task 10

**Steps:** identical wiring with `surface: "salesOrderLine"`, header from `getSalesOrder` route data (`customerId`, `customerLocationId`), `quantity: validation.data.saleQuantity ?? validation.data.quantity ?? 1` (read the SO line validator to pick the real field; if neither exists, use 1 and note).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0
```

**Out of scope:** shipment/invoice-related SO actions.

## Task 12: Wire line forms through the violation hook

**Depends on:** Tasks 10, 11
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteLineForm.tsx`
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderLineForm.tsx`
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/Receipts/ReceiptPostModal.tsx` (or `ShipmentPostModal.tsx`) — how a caller swaps `fetcher.submit` for `rules.submit` and renders `<rules.ViolationModal/>`

**Steps:**
1. Read the precedent to copy the exact hook usage: `const rules = useStorageRuleViolations({ action: <the form's action path> })` from `@carbon/ee/storage-rules`.
2. In each form: route the ValidatedForm submission through the hook's fetcher (`fetcher={rules.fetcher}` if the hook exposes it, else follow the precedent's mechanism exactly) and render `<rules.ViolationModal />` inside the component tree.
3. The acknowledge re-submit appends `acknowledged=true` automatically (hook behavior) — no form changes needed for that.
4. Escape hatch: if `ValidatedForm` + the hook's fetcher don't compose (hook expects manual `submit(formData)`), follow the precedent's onSubmit interception pattern; if neither fits within a small diff, STOP and report with the structural mismatch.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0
```

**Out of scope:** the inline supersession notice in `~/components/Form/Item.tssx` (stays), ConfiguratorModal.

## Task 13: Notifications

**Depends on:** Tasks 10, 11
**Files:**
- Modify: `packages/notifications/src/index.ts` — add `ItemRuleViolation` to `NotificationEvent` (line ~7), map it in `getNotificationTopic` (choose an existing suitable topic or add `ItemRules` topic + display entry), add email heading/CTA entries in `getNotificationEmailHeading`/`getNotificationEmailCtaLabel`
- Modify: `packages/jobs/src/inngest/functions/notifications/notify.ts` — recipient resolution branch for the new event: recipients = company setting `itemRuleNotificationGroup`; default destinations InApp (+Email)
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — add `itemRuleNotificationGroup: z.array(z.string()).optional()` beside `suggestionNotificationGroup` (line ~267); grep `suggestionNotificationGroup` across `apps/erp` to find the settings UI + save action and add the matching field/select there
- Modify: the four enforcement actions (Tasks 10–11) — after the outcome is known, fire-and-forget:
  ```ts
  await trigger("notify", { event: NotificationEvent.ItemRuleViolation, companyId, ... payload: { ruleIds, documentType, documentId, itemIds, outcome: blocked ? "blocked" : "acknowledged", actorId: userId } });
  ```
  matching the exact `trigger("notify", …)` call shape used elsewhere (grep `trigger("notify"` in `apps/erp` for the canonical invocation and payload keys). Fire ONLY when `deduped.length > 0` AND (blocked OR acknowledged-proceed) — never on clean submissions.

**Steps:** as above; read each precedent site before editing; keep the notify handler branch minimal (resolve group members → deliver via existing machinery).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp --filter=@carbon/jobs
# Expected: exit 0
pnpm --filter @carbon/notifications typecheck 2>/dev/null || pnpm exec turbo run typecheck --filter=@carbon/notifications
# Expected: exit 0
```

**Out of scope:** Slack destination config, digest inclusion, recurring-notification logic.

## Task 14: Acknowledgment persistence

**Depends on:** Tasks 10, 11
**Files:**
- Modify: the four enforcement actions — when violations exist and the action PROCEEDS (acknowledged warns), and when it BLOCKS, insert `itemRuleAcknowledgment` rows (one per deduped violation) via the service-role client:
  ```ts
  await serviceRole.from("itemRuleAcknowledgment").insert(deduped.map(v => ({
    companyId, ruleId: v.ruleId, documentType: "quote" /* or "salesOrder" */,
    documentId: quoteId, documentLineId: lineId ?? null, itemId: itemId ?? null,
    severity: v.severity, outcome: blocked ? "blocked" : "acknowledged",
    message: v.message, createdBy: userId
  })));
  ```
  Insert failures must not break the action — log and continue (wrap in try/catch or check error without returning).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/erp
# Expected: exit 0
```

**Out of scope:** an acknowledgments viewing UI (future).

## Task 15: Docs

**Depends on:** Task 4 (naming settled)
**Files:**
- Modify: `packages/utils/AGENTS.md` — replace the "Ask First" line "Modifying `storage-rules.ts` — affects Supabase storage bucket policies and file access patterns." with "Modifying `storage-rules.ts` / `field-registry.ts` — the rule-evaluation engine shared by storage rules and item rules; changes affect rule evaluation across ERP and MES." and the Key Modules row "`storage-rules` | Supabase storage bucket access policies" with "`storage-rules` | Rule engine: condition AST compiler/evaluator for storage + item rules"; fix the `field-registry` row to "Field registry for the rule builder/evaluator".
- Create: `apps/erp/app/modules/item-rules/AGENTS.md` — short module guide following a sibling (`modules/storage-rules` has none; use the AGENTS.md template from `.claude/skills/create-agents-md` conventions: purpose, key tables, service functions, safety notes incl. "reuses the shared engine in @carbon/utils; never fork the modal").

**Verify:**
```bash
grep -c "storage bucket" packages/utils/AGENTS.md
# Expected: 0
```

**Out of scope:** `.claude/rules/*` updates (uncommitted work must not be documented there per keep-sources-in-sync).

## Task 16: Final verification sweep

**Depends on:** all
**Steps:**
1. `pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/ee --filter=@carbon/database --filter=@carbon/erp --filter=@carbon/jobs`
2. `pnpm --filter @carbon/utils test && pnpm --filter @carbon/ee test`
3. `pnpm run lint`
4. Update `.ai/runs/2026-08-11-item-rules.md` phase log + outcome. DO NOT COMMIT — report working-tree summary (`git status --porcelain | head -40`) to the user.

**Verify:** all commands exit 0; report includes file list.
