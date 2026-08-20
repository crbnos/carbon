# Implementation plan — Sales Rules on a unified `enforcementRule` table

- Date: 2026-08-15
- Spec: `.ai/specs/2026-08-11-item-rules.md`
- Scope of this plan: the **data model and code layer** — create the unified rule table, move the shipped Storage Rules onto it, and build the sales family on top. The sales enforcement gates, notifications, and acknowledgment evidence are specified in the spec's Phase 1–3 and planned separately.

## Starting point

`storageRule`, `storageRuleItemAssignment`, and `storageRuleWorkCenterAssignment` are **live in production** with customer data. The engine (`@carbon/utils`), the evaluator shape (`@carbon/ee`), and the violation modal already exist and work.

What does not exist yet: any sales-family table, column, or code.

So the work is: build the unified table, migrate the one shipped family onto it, then add the second family. There is no intermediate per-family sales table at any point — building one and then folding it in would mean two production table transitions instead of one.

## Design decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Table name | `enforcementRule` — "enforcement" is the word the spec and code already use (enforcement gates, evaluate → violations → block/acknowledge). Rejected: bare `rule` (collides conceptually with `configurationRule`/`pricingRule`/`approvalRule`), `businessRule` (vague). UI labels stay "Storage Rules" / "Sales Rules". |
| D2 | Discriminator | `family enforcementRuleFamily NOT NULL` — enum `('storage','sales')`. |
| D3 | Surfaces | One `enforcementRuleSurface` enum: the 11 transaction values + `quoteLine`, `salesOrderLine`. Cross-family subscription is blocked by per-family CHECK (`surfaces <@ ARRAY[…]`) rather than by the column type. `transactionSurface` is dropped once nothing references it. TS keeps per-family unions in `@carbon/utils`, independent of the DB enum. |
| D4 | PK / ids | House composite PK `("id","companyId")`, `DEFAULT id()`. Existing `xid()` storage ids are TEXT and carry over unchanged. |
| D5 | Storage-only columns | `targetType` (enum `enforcementRuleTargetType`, values `item`/`workCenter`) NOT NULL DEFAULT `'item'`; `appliesToAll` NOT NULL DEFAULT FALSE. CHECK pins sales rows to `targetType='item'`, `appliesToAll=false`. |
| D6 | Item filters | `filteredItemTypes`/`filteredItemGroupIds` TEXT[] NOT NULL DEFAULT `'{}'`, `filteredItemMatchAll` NOT NULL DEFAULT FALSE. The shipped storage columns are nullable, so the migration normalizes with COALESCE. |
| D7 | Uniqueness | `UNIQUE (companyId, family, name)` — the same name may exist once per family. |
| D8 | Assignments | Two tables, not one polymorphic: `enforcementRuleItemAssignment` (PK `(itemId, ruleId)`, **both** families) and `enforcementRuleWorkCenterAssignment` (PK `(workCenterId, ruleId)`, storage only). A polymorphic `targetId` cannot carry a real FK, and losing `ON DELETE CASCADE` from `item`/`workCenter` would leave orphaned pins. Both get composite FK `(ruleId, companyId) → enforcementRule(id, companyId)` CASCADE. |
| D9 | Assignment RLS | Each family keeps the permission its shipped table required — storage item pins `parts_*`, work-center pins `resources_*`, sales pins `sales_*` — so no caller's authorization changes. The item table serves both families, so its policies resolve the pinned rule's family with an EXISTS. Normalizing storage item pins to `inventory_*` is deliberately NOT part of this work: it would revoke access from any role holding `parts` but not `inventory`. Recorded as a separate follow-up. |
| D10 | Rule RLS | SELECT: `get_companies_with_employee_role()`. INSERT/UPDATE/DELETE: `(family='storage' AND companyId ∈ inventory_<action>) OR (family='sales' AND companyId ∈ sales_<action>)`. UPDATE needs both `USING` and `WITH CHECK` so a row cannot be edited into a family the actor lacks. |
| D11 | Acknowledgment | `enforcementRuleAcknowledgment`, written by the sales family only; `documentType` CHECK widens later if storage ever persists evidence. |
| D12 | customFieldTable | PK is `("table")`, so the unified table gets ONE registry row — rename the shipped `('storageRule','Storage Rule','Items')` row to `('enforcementRule','Rule','Items')`, which carries every company's existing storage-rule custom-field definitions across via `ON UPDATE CASCADE`. **Product tradeoff: one shared custom-field namespace across both rule editors.** Per-family custom fields would be a UI filter, not a schema change. |
| D13 | Unchanged | Plan keys `STORAGE_RULES`/`SALES_RULES`, the `@carbon/utils` engine, `RuleViolationModal`/`useRuleViolations`, all routes/URLs/sidebars, exported service function names. |

## Tasks

### T1 — Migration: unified schema

`pnpm db:migrate:new enforcement-rules-table`

1. `CREATE TYPE "enforcementRuleFamily"` and `"enforcementRuleSurface"` (13 values, D3).
2. `ALTER TYPE "storageRuleTargetType" RENAME TO "enforcementRuleTargetType"` — same two values, generalized name.
3. `CREATE TABLE "enforcementRule"` per D2–D7: house template (composite PK, `companyId` FK CASCADE, audit columns incl. `updatedBy`, `customFields`), indexes on `companyId`, `createdBy`, and partial `(companyId, family)` / `(companyId, targetType)` where `active`.
   - CHECKs: severity, surfaces non-empty, the two per-family surface subsets, and the sales-shape constraint.
4. Assignment tables per D8; acknowledgment table per D11.
5. RLS per D9/D10 — four policies each, named exactly `SELECT`/`INSERT`/`UPDATE`/`DELETE`, schema-qualified, helper results cast `::text[]`.
   - **Trap to avoid:** in the item-assignment `EXISTS`, an unqualified `"companyId"` binds to the *inner* rule table, making the tenant correlation a tautology. Qualify the outer row: `r."companyId" = "enforcementRuleItemAssignment"."companyId"`.

### T2 — Migration: move the shipped storage rules, drop the old schema

`pnpm db:migrate:new migrate-storage-rules-into-enforcement-rules`

One transaction, every insert `ON CONFLICT DO NOTHING` so a partial re-run is a no-op:

1. `INSERT INTO "enforcementRule" … SELECT …, 'storage'::"enforcementRuleFamily", …, "surfaces"::text[]::"enforcementRuleSurface"[], COALESCE("filteredItemTypes",'{}'), … FROM "storageRule"`.
2. Item pins from `storageRuleItemAssignment`; work-center pins from `storageRuleWorkCenterAssignment`.
3. `customFieldTable` rename per D12 (the `customField` rows follow via `ON UPDATE CASCADE`).
4. `DROP TABLE` the three old tables (assignments first), then `DROP TYPE "transactionSurface"`.

Then `pnpm db:migrate` → `pnpm run generate:types`.

**Verify the data move with real rows before trusting it** — seed a rule with a NULL filter trio, a multi-surface rule, a work-center-target rule with `appliesToAll`, and a pin; confirm after migration that the trio normalized, the surface array cast, the target fields survived, and the pin landed.

### T3 — `@carbon/ee` evaluator/service layer

- `rules/storage/service.ts` + `server.ts` — point every query at `enforcementRule` / the new assignment tables and add `.eq("family","storage")`; stamp `family` on inserts.
- New `rules/sales/` — `service.ts`, `server.ts` (`evaluateSalesRuleLines`), `context.ts` (`buildSalesRuleLineContext`), `index.ts`, mirroring the storage structure.
- **The item pin table is shared, so a pin does not identify a family.** Resolve pinned rules against a family-filtered rule fetch in a second pass — not a PostgREST embed, which would return the other family's rule. This applies to both families.
- Keep family-neutral helpers (`isBlocked`, `dedupeViolations`, the item-filter matcher, the itemCost-embed flattener) at the `rules/` root, not inside `storage/` — otherwise `sales/` has to reach into the storage evaluator for them, and a third family would too.

### T4 — ERP module layer

- Write the admin CRUD **once**, parametrized by family, in `~/modules/shared` (`getEnforcementRules`, `getEnforcementRule`, `upsertEnforcementRule`, `deleteEnforcementRule`, `getEnforcementRuleAssignmentCounts`). Duplicating it per module means two copies of the same query drifting apart.
  - The `family` argument is a union rather than a literal, which drops PostgREST's inferred row type to `any` — state the return type explicitly so callers get a real row.
- Point the storage-rules routes at it with `"storage"`; build the sales-rules routes with `"sales"`.
- Custom-field hooks in both rule editors key off `"enforcementRule"` (D12), not a per-family table name.

### T5 — Regenerate artifacts

`pnpm run generate:types`, `pnpm -w run generate:mcp`, and the swagger schema. If the local Supabase CLI ships a newer PostgREST than the committed schema was generated with, a full regen will churn thousands of unrelated lines — splice only the affected table keys instead and verify the untouched keys are byte-identical.

### T6 — Tests

- Family-filter assertions in the `@carbon/ee` service/evaluator tests; fixture rows gain `family`.
- **Cross-family isolation test** — a pin pointing at the other family's rule must never enter evaluation. Cover both directions; the guard is query-level now, so nothing structural catches a regression.
- Mutation-check the isolation test: remove the guard, confirm the test fails, restore it. A test that cannot fail is not protection.

### T7 — Docs

- `modules/inventory/AGENTS.md` + `modules/sales/AGENTS.md`: shared table, family filtering, shared CRUD, and the "resolve pins against a family-filtered fetch" rule.
- `packages/utils/AGENTS.md`, `packages/ee/AGENTS.md`.
- `.claude/rules/inventory-system.md` — the rule-table lineage and the family-filter requirement.
- Any comment or docstring naming `transactionSurface`, `storageRuleTargetType`, or a per-family rule table is stale the moment T2 lands.

## Verification

```bash
pnpm db:migrate && pnpm run generate:types
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/ee --filter=@carbon/database --filter=@carbon/jobs --filter=erp --filter=mes
pnpm --filter @carbon/utils test && pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test
pnpm run lint
# no code may still reference the dropped tables:
git grep -nE '\.from\("storageRule' -- apps packages
git grep -n "storageRuleItemAssignment\|storageRuleWorkCenterAssignment" -- apps packages ':!packages/database/supabase/migrations' ':!packages/database/src'
```

Then, with a rebuilt dev stack and a logged-in user: a storage rule blocks a receipt post, a sales rule blocks a quote line, and the assignments drawer works on a part for both families. **The RLS policies cannot be verified any other way** — typecheck, tests, and a schema diff all pass on a policy whose tenant correlation silently does nothing.

## Risks

- **Production data migration.** This moves a shipped table with customer data. Mitigations: rules are low-volume config rows, the move is one transaction, inserts are idempotent, the enum array converts via `::text[]::new[]`, and nothing in the migration depends on app code — self-hosted instances run it unattended.
- **RLS is the hardest part to review.** Per-family OR-predicates plus an EXISTS-correlated assignment policy replace four flat per-table policies. Read the policy SQL in T1 more carefully than anything else in the change.
- **Query-level isolation replaces structural isolation.** With one table and one shared pin table, nothing in the schema stops a family leak — only the `family` predicate on every read does. That is what T6's isolation test exists to hold.
- **Shared custom-field namespace** (D12) is a visible behavior change for any company that has storage-rule custom fields today.
- **One enum now grows on both axes.** `enforcementRuleSurface` gains values for warehouse and sales work alike; accepted knowingly as the cost of the single table.
- Generated types lose per-table narrowing (`surfaces` becomes the 13-value union on every row); TS narrowing by `family` compensates in `@carbon/ee`.
