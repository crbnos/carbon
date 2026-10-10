# Field Service Phase D — the contract project roll-up — implementation plan

**Spec:** .ai/specs/2026-10-08-field-service.md (*Contract project*, Phase D acceptance criteria), and .ai/specs/2026-10-03-projects.md (*Service projects → Parent roll-up*)
**Branch:** projects-wbs-research-spec
**Prerequisite:** `.ai/plans/2026-10-09-field-service-phase-a.md` is done and committed. Phase A sets `project.parentProjectId` from the coverage contract and posts Contract coverage to the parent project's account. If either is missing, STOP and report.

## Scope of this plan

A contract project (for example *Acme maintenance 2027*) must see the cost of the service orders that its contract covers:
1. A SQL function returns the cost of each child Service project.
2. The contract project's Costs tab lists its service orders, one row each, and adds them to the total.
3. The parent link stays correct when the coverage contract changes, and Contract coverage refuses a closed parent.
4. The contract page lists its service orders.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/projects-system.md`, `.claude/rules/field-service.md` and `.claude/rules/database-patterns.md` before Task 1.
- Use the `carbon-design` skill for every UI task.
- Never query in a loop. Never construct a database client in a `*.service.ts`.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Progress

- [x] Task 1: Add `get_child_service_project_costs`
- [ ] Task 2: Show service orders on the Costs tab
- [ ] Task 3: Keep the parent link in step with the coverage contract
- [ ] Task 4: Refuse Contract coverage on a closed parent
- [ ] Task 5: List service orders on the contract page
- [ ] Task 6: Extend the demo datasets
- [ ] Task 7: Update the rules, docs and specs
- [ ] Task 8: Verify in the browser

## Dependencies

- Task 1 runs first. Task 2 needs Task 1.
- Tasks 3, 4 and 5 are independent of each other.
- Task 6 needs Tasks 1–5. Task 7 needs Tasks 1–6. Task 8 runs last.

---

## Task 1: Add `get_child_service_project_costs`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_child-service-project-costs.sql`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `getChildServiceProjectCosts`

**Steps:**
1. Run `pnpm db:migrate:new child-service-project-costs`.
2. Write the function. Keep `get_project_cost_summary` unchanged: Phase 3 Task 13 also redefines it, and a separate function avoids a merge between the two.

```sql
CREATE OR REPLACE FUNCTION get_child_service_project_costs(p_project_id TEXT, p_company_id TEXT)
RETURNS TABLE (
  "projectId" TEXT,
  "serviceOrderId" TEXT,
  "serviceOrderReadableId" TEXT,
  "status" "serviceOrderStatus",
  "customerAssetId" TEXT,
  "actual" NUMERIC,
  "actualHours" NUMERIC,
  "billed" NUMERIC,
  "unbilled" NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM assert_company_access(p_company_id);
  RETURN QUERY
  SELECT p."id", so."id", so."serviceOrderId", so."status", so."customerAssetId",
    COALESCE((SELECT SUM(l."amount") FROM "projectLedger" l
              WHERE l."projectId" = p."id" AND l."companyId" = p."companyId"), 0),
    COALESCE((SELECT SUM(t."hours") FROM "timesheetEntry" t
              WHERE t."projectId" = p."id" AND t."companyId" = p."companyId" AND t."status" = 'Posted'), 0),
    COALESCE((SELECT SUM(b."amount") FROM "projectBillableItem" b
              WHERE b."projectId" = p."id" AND b."companyId" = p."companyId" AND b."status" = 'Billed'), 0),
    COALESCE((SELECT SUM(b."amount") FROM "projectBillableItem" b
              WHERE b."projectId" = p."id" AND b."companyId" = p."companyId" AND b."status" = 'Unbilled'), 0)
  FROM "project" p
  JOIN "serviceOrder" so ON so."projectId" = p."id" AND so."companyId" = p."companyId"
  WHERE p."parentProjectId" = p_project_id AND p."companyId" = p_company_id
    AND p."projectType" = 'Service';
END $$;
```

3. Add an index on `project ("parentProjectId", "companyId") WHERE "parentProjectId" IS NOT NULL` if Phase A did not.
4. Run `pnpm db:migrate`, then `pnpm run generate:types`.
5. Add `getChildServiceProjectCosts(client, projectId, companyId)`, which calls the RPC.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM get_child_service_project_costs('<a contract project id>', '<company id>');"
# Expected: the function runs and returns one row per service order of that contract
```

**Out of scope:** child projects of type Standard. Only Service projects have a parent.

---

## Task 2: Show service orders on the Costs tab

**Depends on:** 1
**Files:**
- Modify: `apps/erp/app/routes/x+/project+/$projectId.costs.tsx` (Phase 1a Task 38)
- Create: `apps/erp/app/modules/projects/ui/Costs/ServiceOrderCosts.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Costs/ProjectCostsTree.tsx`

**Steps:**
1. The loader calls `getChildServiceProjectCosts` once, beside `getProjectCostSummary`.
2. When it returns rows, show a **Service orders** section under the tree. One row per order: readable id (a link to `path.to.serviceOrder(id)`), status, the asset's serial, hours, actual, billed and unbilled.
3. The project's top total row adds the service orders' actual. Show it as two figures, "Actual 12,400 (of which service 3,100)", so the project's own cost stays readable.
4. The link opens the order only for users with `service_view`. Others see the readable id as text.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** drilling into a service order's ledger from the contract project. The order's own page has it.

---

## Task 3: Keep the parent link in step with the coverage contract

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/service/service.server.ts` — `updateServiceOrderCoverageContract`
- Modify: `apps/erp/app/routes/x+/service-order+/$id.details.tsx` (the coverage contract property)

**Steps:**
1. Add `updateServiceOrderCoverageContract(db, { companyId, userId, serviceOrderId, customerContractId })`. In one Kysely transaction:
   1. Refuse when the order's project has a `projectLedger` row with coverage `Contract`. Those charges already posted to the old contract's account. The message tells the user to reclass them first (`reclass-project-coverage`, Phase A Task 10).
   2. Update `serviceOrder.customerContractId`.
   3. Set `project.parentProjectId` to the new contract's `projectId`, or null.
2. The coverage contract property posts to this function instead of a plain update.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** moving posted charges between contracts automatically.

---

## Task 4: Refuse Contract coverage on a closed parent

**Depends on:** none
**Files:**
- Modify: `packages/server-functions/src/lib/project-posting.ts` (the By Coverage branch)
- Modify: `packages/server-functions/src/lib/project-posting.test.ts`

**Steps:**
1. In the By Coverage branch, when the coverage is Contract and `parentProjectId` is set, load the parent project's status.
2. If the parent is Closed, throw `ProjectChargeError` with the message "The contract project <identifier> is closed. Change the coverage to Billable, or reopen the contract project."
3. Technically Complete and On Hold parents still accept the charge, as `assertChargeable` mode `'commitment'` allows.
4. Add a test: Contract coverage with a Closed parent throws, and with an On Hold parent posts.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-posting
# Expected: all tests pass
```

**Out of scope:** a Closed parent's effect on Warranty and Billable charges. They never post to the parent.

---

## Task 5: List service orders on the contract page

**Depends on:** none
**Files:**
- Create: the contract's service orders route (find the contract detail routes with `ls apps/erp/app/routes/x+/ | grep -i contract`)
- Create: `apps/erp/app/modules/service/ui/ServiceOrders/ContractServiceOrders.tsx`
- Modify: the contract page's navigation or tabs

**Steps:**
1. Add a **Service orders** tab to the contract page, visible with `service_view`.
2. It lists the orders whose `customerContractId` is the contract: readable id, status, serial, site, dates, actual cost and billed amount. Reuse `ServiceOrdersTable` with a fixed filter.
3. Read the costs with one query: the orders, then `get_child_service_project_costs` on the contract's project when it has one.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** billing service work through the contract (projects Phase 4).

---

## Task 6: Extend the demo datasets

**Depends on:** 1–5
**Files:**
- Modify: `packages/database/src/datasets/data/satellite/sales.ts`, `packages/database/src/datasets/tiers/04-sales.ts`

**Steps:**
1. In the satellite dataset, give one seeded customer contract a project (an Expense project named after the contract).
2. Set that contract as the coverage contract of one seeded service order. Its Service project gets `parentProjectId`.
3. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** posted contract charges in the datasets.

---

## Task 7: Update the rules, docs and specs

**Depends on:** 1–6
**Files:**
- Modify: `.claude/rules/field-service.md`, `.claude/rules/projects-system.md`
- Modify: `docs/content/docs/reference/service-orders.mdx`, `docs/content/docs/reference/projects.mdx`
- Modify: `.ai/specs/2026-10-08-field-service.md`, `.ai/specs/2026-10-03-projects.md`

**Steps:**
1. Document `get_child_service_project_costs`, the coverage contract change rule and the closed-parent refusal.
2. In the field service spec, mark Phase D done and record 2 decisions:
   1. **Separate function:** the child costs come from their own function, so `get_project_cost_summary` stays as Phase 1a and Phase 3 define it.
   2. **Contract change:** refused after a Contract charge posts, until a reclass.
3. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
```

**Out of scope:** the changelog entry.

---

## Task 8: Verify in the browser

**Depends on:** 1–7
**Files:**
- Create: `.ai/playbooks/field-service-phase-d.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on.
2. Cover these criteria:
   1. **Contract project** (spec Phase D): an order whose coverage contract has a project gets that project as parent. Its Contract charges post to that project's account. The contract project's Costs tab shows the order as one row.
   2. **Contract change:** changing the coverage contract of an order with no Contract charge moves the parent. With a Contract charge, it is refused with the reclass message.
   3. **Closed parent:** a Contract charge on an order whose contract project is Closed is refused with the message from Task 4.
   4. **Contract page:** the contract's Service orders tab lists the order with its cost.
3. Save the playbook to `.ai/playbooks/field-service-phase-d.md`.

**Verify:**
```bash
ls .ai/playbooks/field-service-phase-d.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phase 4 contract billing.

## Execution notes

- Prerequisite check: the Phase A artifacts this plan names exist (`project.parentProjectId` set from the coverage contract by `insertServiceOrder`, and the Contract branch of `resolveProjectPostingAccount`).
- Task 1: Phase A already added `project_parentProjectId_idx` on `("parentProjectId", "companyId")`, so step 3 adds no index. The function is `plpgsql` with `ORDER BY so."serviceOrderId"`, so its order reaches PostgREST (the `LANGUAGE sql` inlining lesson). The local database has no contract project with a child. A rolled-back check set one service order's project parent to a Standard project, and the function returned that order with zeros. `pnpm db:migrate` regenerated the types and swagger; the MCP digest did not change.
