# Merge storageRule + salesRule into one table

- Date: 2026-08-15
- Status: **IMPLEMENTED** 2026-08-15 on `naveen/item-rules`. Deviations from the plan as written are marked **[DEVIATION]** below.
- Prereq spec: `.ai/specs/2026-08-11-item-rules.md` (records the deferral this plan now reverses)
- Grounding: full schema/reference inventory verified against branch `naveen/item-rules` on 2026-08-15

## Why now / sequencing (Decision 0)

`salesRule*` tables exist only on `naveen/item-rules` (unmerged). Do this merge as a **stacked branch on `naveen/item-rules`, landed in the same release train**, so production only ever performs ONE table transition: `storageRule` (shipped, has customer data) → merged table. The `salesRule*` tables will be empty or near-empty when their rows migrate.

Alternative (not recommended): rewrite the unshipped `20260810*` migrations yet again so `salesRule` never exists. Less prod churn on paper, but it muddies an already-pushed, reviewable branch.

## Design decisions (baked into the tasks; override before starting)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Merged table name | `enforcementRule` — "enforcement" is the word the spec and code already use (enforcement gates, evaluate → violations → block/acknowledge). Alternatives considered: bare `rule` (collides conceptually with `configurationRule`/`pricingRule`/`approvalRule`), `businessRule` (vague). UI labels stay "Storage Rules" / "Sales Rules". |
| D2 | Discriminator | `family enforcementRuleFamily NOT NULL` — enum `('storage','sales')`. |
| D3 | Surfaces | New enum `enforcementRuleSurface` = union (11 transaction values + `quoteLine`, `salesOrderLine` = 13). Column `surfaces enforcementRuleSurface[] NOT NULL`. Illegal cross-family surfaces prevented by per-family CHECK (`surfaces <@ ARRAY[...allowed...]`), replacing the old per-table enum typing. Old enums `transactionSurface` + `salesRuleSurface` are dropped after migration. TS keeps the per-family unions in `@carbon/utils` (already independent of the DB enums). |
| D4 | PK / ids | House composite PK `("id","companyId")`, `DEFAULT id()`. Existing storage `xid()` ids are TEXT and migrate as-is. |
| D5 | Storage-only columns | `targetType` (enum renamed `storageRuleTargetType` → `enforcementRuleTargetType`, values `item`/`workCenter`) NOT NULL DEFAULT `'item'`; `appliesToAll` NOT NULL DEFAULT FALSE. CHECK: `family='sales' → targetType='item' AND appliesToAll=FALSE`. |
| D6 | Filters | `filteredItemTypes`/`filteredItemGroupIds` TEXT[] NOT NULL DEFAULT '{}', `filteredItemMatchAll` NOT NULL DEFAULT FALSE (storage's nullable trio is normalized with COALESCE during migration). |
| D7 | Uniqueness | `UNIQUE (companyId, family, name)` — same name may exist in both families today (two tables). |
| D8 | Assignments | TWO tables, not one polymorphic: `enforcementRuleItemAssignment` (PK `(itemId, ruleId)`, serves BOTH families — absorbs `storageRuleItemAssignment` + `salesRuleAssignment`) and `enforcementRuleWorkCenterAssignment` (PK `(workCenterId, ruleId)`). Real FKs with ON DELETE CASCADE from `item`/`workCenter` are worth more than one table; a polymorphic `targetId` cannot have them. Both get composite FK `(ruleId, companyId) → enforcementRule(id, companyId)` CASCADE. |
| D9 | Assignment RLS **[DEVIATION — not normalized]** | Today it is inconsistent: storage item pins `parts_*`, workCenter pins `resources_*`, sales pins `sales_*`. Shipped behavior PRESERVES each source table's permission rather than tightening it (storage item pins stay `parts_*`, work-center pins stay `resources_*`, sales pins stay `sales_*`) so the merge changes no caller's authorization. Implemented via `EXISTS (SELECT 1 FROM enforcementRule r WHERE r.id = "ruleId" AND r."companyId" = "companyId" AND ((r.family='storage' AND <inventory_perm>) OR (r.family='sales' AND <sales_perm>)))`. WorkCenter table needs only the storage arm. Tightening storage item pins to `inventory_*` was considered and rejected: it would break any role holding `parts` but not `inventory`. Recorded as a possible follow-up. |
| D10 | Rule RLS | SELECT: `get_companies_with_employee_role()`. INSERT/UPDATE/DELETE: `(family='storage' AND companyId ∈ inventory_<action>) OR (family='sales' AND companyId ∈ sales_<action>)`. Give UPDATE both USING and WITH CHECK so a row can't be flipped into a family the actor lacks. |
| D11 | Acknowledgment | Rename `salesRuleAcknowledgment` → `enforcementRuleAcknowledgment`, shape unchanged (still sales-only writers; `documentType` CHECK extends later if storage ever persists acks). |
| D12 | customFieldTable | PK is `("table")` → the merged table gets ONE row: UPDATE the shipped `('storageRule','Storage Rule','Items')` row to `('enforcementRule','Rule', 'Items')`, remap `customField` definition rows from both `storageRule` and `salesRule`, delete the `salesRule` row. **Product tradeoff: one shared custom-field namespace across both rule editors.** If per-family custom fields matter, that is a follow-up UI filter, not a schema issue. |
| D13 | Unchanged | Plan keys `STORAGE_RULES`/`SALES_RULES`, the `@carbon/utils` engine, `RuleViolationModal`/`useRuleViolations`, all routes/URLs/sidebars, `NotificationEvent.SalesRuleViolation`, `companySettings.salesRuleNotificationGroup`, exported service function names. |

## Tasks

### T1 — Migration 1: schema (`pnpm db:migrate:new create-enforcement-rules`)

`packages/database/supabase/migrations/<ts>_create-enforcement-rules.sql`

1. `CREATE TYPE "enforcementRuleFamily" AS ENUM ('storage','sales');`
2. `CREATE TYPE "enforcementRuleSurface" AS ENUM ('receipt','shipment','stockTransfer','warehouseTransfer','inventoryAdjustment','place','pick','operationStart','operationFinish','materialIssue','materialReceive','quoteLine','salesOrderLine');`
3. `ALTER TYPE "storageRuleTargetType" RENAME TO "enforcementRuleTargetType";`
4. `CREATE TABLE "enforcementRule"` per D2–D7 (house template: composite PK, audit cols incl. `updatedBy`, `customFields`, indexes on `companyId`, `createdBy`, `(companyId, family)` partial WHERE active, `(companyId, targetType)` partial WHERE active).
   - CHECKs: severity, surfaces nonempty, per-family surface subset (two constraints), sales-shape constraint (D5).
5. Assignment tables per D8 (audit cols incl. `updatedBy` on both — `salesRuleAssignment` currently lacks it; add it here).
6. `enforcementRuleAcknowledgment` per D11 (verbatim clone of current shape + `ruleName`).
7. RLS per D9/D10 — four policies each, exact names `SELECT`/`INSERT`/`UPDATE`/`DELETE`, schema-qualified, `::text[]` casts.

### T2 — Migration 2: data + drops (`pnpm db:migrate:new migrate-rules-into-enforcement-rules`)

Single transaction, idempotent (`ON CONFLICT DO NOTHING` everywhere):

1. `INSERT INTO "enforcementRule" SELECT id, companyId, 'storage'::"enforcementRuleFamily", …, surfaces::text[]::"enforcementRuleSurface"[], COALESCE(filteredItemTypes,'{}'), … FROM "storageRule";` then same for `salesRule` with `'sales'`.
2. Item assignments from `storageRuleItemAssignment` ∪ `salesRuleAssignment`; workCenter assignments from `storageRuleWorkCenterAssignment`.
3. Acknowledgment rows copied from `salesRuleAcknowledgment`.
4. `customField` remap: `UPDATE "customField" SET "table"='enforcementRule' WHERE "table" IN ('storageRule','salesRule')` (verify actual column/table names against `20240311021818_custom-fields.sql` before writing — the definitions table may key differently); `UPDATE "customFieldTable" SET "table"='enforcementRule', "name"='Rule' WHERE "table"='storageRule'; DELETE FROM "customFieldTable" WHERE "table"='salesRule';`
5. `DROP TABLE` old five tables (assignments first, then acks, then rules); `DROP TYPE "transactionSurface"; DROP TYPE "salesRuleSurface";`

Then: `pnpm db:migrate` (healthy local stack required — the seoul workspace DB must be rebuilt first) → `pnpm run generate:types`.

### T3 — `@carbon/ee` evaluator/service layer

- `packages/ee/src/rules/storage/service.ts` — `.from("storageRule")` → `.from("enforcementRule").eq("family","storage")` at L116, L230, L403; `assignmentTableFor` (L37-42) → new assignment table names; stamp `family: "storage"` on any insert.
- `packages/ee/src/rules/storage/server.ts` — table swap at L568.
- `packages/ee/src/rules/sales/service.ts` — swaps at L73, L79, L149, L154, L285, L298, L314 (+ `.eq("family","sales")`, item-assignment table shared with storage — sales reads must ALSO filter by rule family via the embed).
- Exported names unchanged. Update `SalesRuleDbRow`/row types to the merged generated type narrowed by family.

### T4 — ERP module CRUD

- `apps/erp/app/modules/inventory/inventory.service.ts` L3986–4064: table swaps + `family` filter/stamp; `getRuleAssignmentCounts` now reads the two merged assignment tables filtered to storage-family rules.
- `apps/erp/app/modules/sales/sales.service.ts` L6150–6216: same for sales.
- Acknowledgment writers (6 sites): `x+/quote+/$quoteId.new.tsx` L105+L183, `$quoteId.$lineId.details.tsx` L236, `x+/sales-order+/$orderId.new.tsx` L117+L195, `$orderId.$lineId.details.tsx` L179 → `.from("enforcementRuleAcknowledgment")`.

### T5 — Regenerate artifacts

`pnpm run generate:types` (already in T2), `pnpm -w run generate:mcp`, swagger via `crbn migrate` regen (or the deterministic transform if the CLI stack's PostgREST version mismatches — see 2026-08-15 rename precedent).

### T6 — Tests

- `packages/ee` service/evaluator tests: add family-filter assertions; fixture rows gain `family`.
- New test: cross-family isolation — a storage rule subscribed to `receipt` never returns from `getActiveSalesRulesForItems` and vice versa (the regression the old separate enums structurally prevented).
- Migration sanity (manual, against local): row counts old vs new, spot-check a storage rule with workCenter target and a sales rule with assignments.

### T7 — Docs sync (same PR)

- Spec: flip the "Decision. Keep the tables separate" paragraph to record Option B as implemented (name, family enum, CHECK-based surface guard) with date.
- `apps/erp/app/modules/inventory/AGENTS.md` + `modules/sales/AGENTS.md`: table tables → `enforcementRule*`, note shared table + family filter.
- `packages/utils/AGENTS.md`, `packages/ee/AGENTS.md`: "tables stay separate" phrasing → merged.
- `.claude/rules/inventory-system.md` gotcha line gains the newest rename hop; kb docs + `docs/content/docs/reference/storage-rules.mdx` if they name tables.

## Verification

```bash
pnpm db:migrate && pnpm run generate:types
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/ee --filter=@carbon/database --filter=@carbon/jobs --filter=erp --filter=mes
pnpm --filter @carbon/utils test && pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test
pnpm run lint
git grep -nE '\.from\("(storageRule|salesRule)' -- apps packages   # must return nothing outside migrations
git grep -n "storageRuleItemAssignment\|storageRuleWorkCenterAssignment\|salesRuleAssignment\|salesRuleAcknowledgment" -- apps packages ':!packages/database/supabase/migrations' ':!packages/database/src'   # must be empty
```

Browser (optional, after user rebuilds the dev stack): storage rule blocks a receipt post; sales rule blocks a quote line; assignments drawer works on a part for both families.

## Risks / notes

- **Prod data migration** — the reason the spec deferred this. Mitigations: rules are low-volume config rows; one transaction; idempotent inserts; enum-array migration via `::text[]::new[]` cast; self-hosted runs it unattended with no app-code dependency.
- **RLS complexity is the real cost**: per-family OR-predicates on the rule table and EXISTS-joins on assignments replace four simple per-table policies. The policy SQL in T1 is the part to review hardest.
- **Shared custom-field namespace** (D12) — visible product behavior change if anyone has storageRule custom fields in prod.
- **Enum coupling accepted**: one `enforcementRuleSurface` enum now grows on both axes; that was the spec's main argument against merging, and merging accepts it knowingly.
- Generated types lose the per-table narrowing (`surfaces` becomes the 13-value union on every row); TS-level narrowing by `family` compensates in `@carbon/ee`.
