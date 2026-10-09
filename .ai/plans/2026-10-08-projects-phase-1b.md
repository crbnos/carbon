# Projects Phase 1b — implementation plan

**Spec:** .ai/specs/2026-10-03-projects.md (Phase 1b: *Capital projects*, *Trace links*, *Verification*, *Parameters and allocations*, *Views*, *Templates*)
**Research:** .ai/research/projects-systems-engineering-ux.md, .ai/research/projects-wbs-pmmo.md, .ai/research/serial-service-cost-treatment.md (fleet unit betterments)
**Branch:** projects-wbs-research-spec
**Prerequisite:** every task of `.ai/plans/2026-10-07-projects-phase-1a.md` is done and committed. This plan names Phase 1a files, functions and tables. If a named Phase 1a artifact does not exist, STOP and report.

## Scope of this plan

1. **Capital projects (the Capitalize treatment):**
   - one CIP asset per final-asset element, created on release;
   - every cost source writes `fixedAssetCipCost`;
   - jobs use the existing `job.fixedAssetId` sweep;
   - **Place in service** runs `capitalizeCip`;
   - late costs post to the Active asset, and Straight Line depreciation moves to a remaining-life basis.
2. **Trace links, suspect links, verification and Parameters.** This includes Formula and Item parameters, contingency and requirement categories. A constraint is a Requirement over a Formula Parameter (spec, 2026-10-08).
3. **The Tree, Timeline and Reader layouts**, with a Reader PDF.
4. **Saved views and per-user preferences** for the Elements page.
5. **Project templates** (copy a project).
6. **Create Job** and **Create PO line** from a plan-line material.
7. **Charge numbers on reimbursement lines.** Charge lines get a read-only display; they are not editable in the ERP today (`.ai/specs/2026-09-23-editable-imported-spend-documents.md` owns that).
8. **The milestone burn chart.**
9. **Part links:** any element except a Parameter links an item and, optionally, one serial. **Build from part** creates elements from a serial's build history, an item's make method or a template. The element history by part shows past hours on the same item.

## Rules for the executor

- Read `.ai/lessons.md`, `.claude/rules/conventions-services.md`, `.claude/rules/conventions-forms.md`, `.claude/rules/database-patterns.md`, `.claude/rules/authz-manifest.md`, `.claude/rules/fixed-asset-lifecycle.md` and `.claude/rules/projects-system.md` (written by Phase 1a Task 46) before Task 1.
- Use the `carbon-design` skill for every UI task.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- Never use JavaScript `Date`. Use `@internationalized/date` and the `datetime` helpers in `@carbon/utils`.
- Round money with `round()` from `@carbon/utils`.
- Never query in a loop. Collect the ids and use one `.in()` call or one Kysely query.
- Never construct a database client in a `*.service.ts`.
- 🛑 Leave `CONSTRUCTION_IN_PROGRESS_ENABLED` (`apps/erp/app/modules/accounting/accounting.models.ts:916`) at `false`. Project screens read CIP classes with their own query. Turning the global flag on is a separate product decision.
- If a quoted code line or line number does not match the file, search for the quoted code. If you cannot find it, STOP and report.

## Progress

- [x] Task 1: Create the Phase 1b enum migration
- [x] Task 2: Create the capital projects migration
- [ ] Task 3: Create the trace links and element fields migration
- [ ] Task 4: Create the views and preferences migration
- [ ] Task 5: Apply migrations, regenerate types, ship RLS
- [ ] Task 6: Add Capitalize to the posting helpers and the SQL mirror
- [ ] Task 7: Create CIP assets on release and on marking a final asset
- [ ] Task 8: Write CIP cost rows from the project posting paths
- [ ] Task 9: Charge Capitalize jobs through `job.fixedAssetId`
- [ ] Task 10: Add Place in service
- [ ] Task 11: Post late costs to the Active asset and fix the void guards
- [ ] Task 12: Move Straight Line depreciation to a remaining-life basis
- [ ] Task 13: Add the capital project fields to the project and element UI
- [ ] Task 14: Add the trace link and suspect service functions
- [ ] Task 15: Add the Requirement, Test Case and Parameter fields and the verification read
- [ ] Task 16: Add the trace link, verification and parameter sections to the element page
- [ ] Task 17: Build the Tree layout
- [ ] Task 18: Build the Timeline layout
- [ ] Task 19: Build the Reader layout
- [ ] Task 20: Add the Reader PDF
- [ ] Task 21: Add saved views and per-user preferences
- [ ] Task 22: Add project templates
- [ ] Task 23: Add Create Job from a plan-line material
- [ ] Task 24: Add Create PO line from a plan-line material
- [ ] Task 25: Add charge numbers to reimbursement lines and show them on charges
- [ ] Task 26: Add the milestone burn chart
- [ ] Task 27: Add part links and item values
- [ ] Task 28: Add Build from part
- [ ] Task 29: Add the element history by part
- [ ] Task 30: Extend the demo datasets
- [ ] Task 31: Update the rule file, module AGENTS.md, docs and spec
- [ ] Task 32: Verify in the browser

## Dependencies

- Tasks 1 → 2 → 3 → 4 → 5 run in order.
- Tasks 6–13 (capital projects) need Task 5. Task 6 comes before Tasks 7–11. Task 12 is independent of Tasks 6–11. Task 13 needs Tasks 7 and 10.
- Tasks 14–16 need Task 5. Task 16 needs Tasks 14 and 15.
- Tasks 17–20 need Task 14. Task 20 needs Task 19.
- Task 21 needs Task 5. Task 22 needs Tasks 14 and 15.
- Tasks 23–26 need Task 5 and are independent of each other.
- Task 27 needs Tasks 5 and 15. Task 28 needs Tasks 22 and 27. Task 29 needs Task 27.
- Task 30 needs Tasks 5, 14, 15 and 27. Task 31 needs Tasks 1–30. Task 32 runs last.

---

## Task 1: Create the Phase 1b enum migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-1b-enums.sql`

**Steps:**
1. Run `pnpm db:migrate:new projects-1b-enums`.
2. Write only these statements:

```sql
CREATE TYPE "projectElementLinkType" AS ENUM ('satisfies', 'verifies', 'derives', 'implements', 'blocks', 'precedes', 'relates to', 'feeds');
CREATE TYPE "requirementCategory" AS ENUM ('Functional', 'Performance', 'Interface', 'Environmental', 'Design Constraint');
CREATE TYPE "requirementTargetOperator" AS ENUM ('≤', '≥', '=', 'Range');
CREATE TYPE "requirementVerificationMethod" AS ENUM ('Test', 'Analysis', 'Inspection', 'Demonstration');
CREATE TYPE "testCaseVerdict" AS ENUM ('Not Run', 'Pass', 'Fail', 'Inconclusive');
CREATE TYPE "parameterSource" AS ENUM ('Manual', 'Sum', 'Min', 'Max', 'Formula', 'Item');
CREATE TYPE "projectLayout" AS ENUM ('list', 'board', 'table', 'tree', 'timeline', 'reader');
```

**Verify:**
```bash
grep -c "CREATE TYPE" packages/database/supabase/migrations/*_projects-1b-enums.sql
# Expected: 7
```

**Out of scope:** any table change.

---

## Task 2: Create the capital projects migration

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-capital.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261006220401_fleet-bridge.sql` (lines 95–117)

**Steps:**
1. Run `pnpm db:migrate:new projects-capital`.
2. Write the SQL below. Add an index on every new FK column.

```sql
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "fixedAssetClassId" TEXT REFERENCES "fixedAssetClass"("id"),
  ADD COLUMN IF NOT EXISTS "fixedAssetId" TEXT REFERENCES "fixedAsset"("id");

ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "isFinalAsset" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "fixedAssetId" TEXT REFERENCES "fixedAsset"("id");

ALTER TABLE "fixedAssetCipCost" DROP CONSTRAINT IF EXISTS "fixedAssetCipCost_sourceType_check";
ALTER TABLE "fixedAssetCipCost"
  ADD CONSTRAINT "fixedAssetCipCost_sourceType_check" CHECK ("sourceType" IN
    ('Purchase Invoice', 'Receipt', 'Job', 'Manual', 'Timesheet', 'Project Issue', 'Charge', 'Reimbursement')),
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectElementId" TEXT,
  ADD COLUMN IF NOT EXISTS "postCapitalization" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "fixedAssetCipCost"
  ADD CONSTRAINT "fixedAssetCipCost_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE SET NULL ("projectId"),
  ADD CONSTRAINT "fixedAssetCipCost_projectElement_fkey" FOREIGN KEY ("projectElementId", "companyId") REFERENCES "projectElement"("id", "companyId") ON DELETE SET NULL ("projectElementId");
```

3. Run `psql` or read `20261006220401_fleet-bridge.sql` line 99 to confirm the inline CHECK name. If the name is not `fixedAssetCipCost_sourceType_check`, use the real name in the `DROP`.

**Verify:**
```bash
grep -c "postCapitalization" packages/database/supabase/migrations/*_projects-capital.sql
# Expected: 1
```

**Out of scope:** any change to `fixedAsset` columns.

---

## Task 3: Create the trace links and element fields migration

**Depends on:** 2
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-trace-links.sql`

**Steps:**
1. Run `pnpm db:migrate:new projects-trace-links`.
2. Write the SQL below. Add an index on `companyId` and every FK column.

```sql
ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "targetOperator" "requirementTargetOperator",
  ADD COLUMN IF NOT EXISTS "targetValue" NUMERIC,
  ADD COLUMN IF NOT EXISTS "targetUpperValue" NUMERIC,
  ADD COLUMN IF NOT EXISTS "targetUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "verificationMethod" "requirementVerificationMethod",
  ADD COLUMN IF NOT EXISTS "actualParameterId" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityDocumentId" TEXT,
  ADD COLUMN IF NOT EXISTS "verdict" "testCaseVerdict",
  ADD COLUMN IF NOT EXISTS "verdictAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "verdictBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "parameterValue" NUMERIC,
  ADD COLUMN IF NOT EXISTS "parameterUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "parameterSource" "parameterSource",
  ADD COLUMN IF NOT EXISTS "allocationPercent" NUMERIC CHECK ("allocationPercent" IS NULL OR ("allocationPercent" >= 0 AND "allocationPercent" <= 1)),
  ADD COLUMN IF NOT EXISTS "requirementCategory" "requirementCategory",
  ADD COLUMN IF NOT EXISTS "parameterFormula" TEXT,
  ADD COLUMN IF NOT EXISTS "parameterItemField" TEXT,
  ADD COLUMN IF NOT EXISTS "parameterContingencyPercent" NUMERIC CHECK ("parameterContingencyPercent" IS NULL OR ("parameterContingencyPercent" >= 0 AND "parameterContingencyPercent" <= 1));
ALTER TABLE "projectElement"
  ADD CONSTRAINT "projectElement_formula_check" CHECK ("parameterSource" IS DISTINCT FROM 'Formula' OR "parameterFormula" IS NOT NULL),
  ADD CONSTRAINT "projectElement_itemField_check" CHECK ("parameterSource" IS DISTINCT FROM 'Item' OR "parameterItemField" IS NOT NULL);
ALTER TABLE "projectElement"
  ADD CONSTRAINT "projectElement_actualParameter_fkey" FOREIGN KEY ("actualParameterId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE SET NULL ("actualParameterId"),
  ADD CONSTRAINT "projectElement_range_check" CHECK ("targetOperator" IS DISTINCT FROM 'Range' OR "targetUpperValue" IS NOT NULL);

CREATE TABLE IF NOT EXISTS "projectElementLink" (
  "id" TEXT NOT NULL DEFAULT id('pjk'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fromElementId" TEXT NOT NULL,
  "toElementId" TEXT NOT NULL,
  "linkType" "projectElementLinkType" NOT NULL,
  "suspectSince" TIMESTAMP WITH TIME ZONE,
  "reviewedAt" TIMESTAMP WITH TIME ZONE,
  "reviewedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementLink_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementLink_key" UNIQUE ("fromElementId", "toElementId", "linkType", "companyId"),
  CONSTRAINT "projectElementLink_from_fkey" FOREIGN KEY ("fromElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLink_to_fkey" FOREIGN KEY ("toElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "projectElementLink_self_check" CHECK ("fromElementId" <> "toElementId")
);
```

**Verify:**
```bash
grep -c "projectElementLink" packages/database/supabase/migrations/*_projects-trace-links.sql
# Expected: at least 6
```

3. Add the part link serial. `projectElement.itemId` exists from Phase 1a.

```sql
ALTER TABLE "projectElement" ADD COLUMN IF NOT EXISTS "trackedEntityId" TEXT REFERENCES "trackedEntity"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "projectElement_trackedEntityId_idx" ON "projectElement" ("trackedEntityId") WHERE "trackedEntityId" IS NOT NULL;

-- A serial must belong to the element's item. A serial with no item set fills it.
CREATE OR REPLACE FUNCTION "projectElement_part_link_check"() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_item TEXT;
BEGIN
  IF NEW."trackedEntityId" IS NULL THEN RETURN NEW; END IF;
  SELECT "itemId" INTO v_item FROM "trackedEntity" WHERE "id" = NEW."trackedEntityId" AND "companyId" = NEW."companyId";
  IF v_item IS NULL THEN RAISE EXCEPTION 'The serial % has no item in this company', NEW."trackedEntityId"; END IF;
  IF NEW."itemId" IS NULL THEN NEW."itemId" := v_item;
  ELSIF NEW."itemId" <> v_item THEN RAISE EXCEPTION 'The serial belongs to a different item'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "projectElement_part_link_check" BEFORE INSERT OR UPDATE OF "itemId", "trackedEntityId"
  ON "projectElement" FOR EACH ROW EXECUTE FUNCTION "projectElement_part_link_check"();
```

4. A Parameter cannot link a part. Add `CHECK ("type" <> 'Parameter' OR ("itemId" IS NULL AND "trackedEntityId" IS NULL))`.

**Out of scope:** cross-project links. Both ends must be in one project.

---

## Task 4: Create the views and preferences migration

**Depends on:** 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_projects-views-verification.sql`

**Steps:**
1. Run `pnpm db:migrate:new projects-views-verification`.
2. Write the tables:

```sql
CREATE TABLE IF NOT EXISTS "projectView" (
  "id" TEXT NOT NULL DEFAULT id('pjv'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isShared" BOOLEAN NOT NULL DEFAULT FALSE,
  "layout" "projectLayout" NOT NULL DEFAULT 'list',
  "filters" JSONB NOT NULL DEFAULT '{}',
  "displayOptions" JSONB NOT NULL DEFAULT '{}',
  "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectView_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectView_name_key" UNIQUE ("projectId", "name", "createdBy", "companyId"),
  CONSTRAINT "projectView_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "projectUserPreference" (
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "companyId" TEXT NOT NULL,
  "layout" "projectLayout" NOT NULL DEFAULT 'list',
  "filters" JSONB NOT NULL DEFAULT '{}',
  "displayOptions" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "projectUserPreference_pkey" PRIMARY KEY ("projectId", "userId", "companyId"),
  CONSTRAINT "projectUserPreference_project_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "project"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectUserPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
```

3. Do not write a SQL function for verification. Task 15 computes it in a pure TypeScript function from the rows the page already loads. So it is unit-tested and needs no second query.

**Verify:**
```bash
grep -c "CREATE TABLE IF NOT EXISTS" packages/database/supabase/migrations/*_projects-views-verification.sql
# Expected: 2
```

**Out of scope:** unit conversion. Units are free text and never convert.

---

## Task 5: Apply migrations, regenerate types, ship RLS

**Depends on:** 4
**Files:**
- Modify: `packages/database/src/authz/manifest.ts`
- Modify: generated types
- Create: the generated RLS migration

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm run generate:types`.
3. Add these rules to `manifest.ts` in alphabetical order:

```ts
projectElementLink: company("projects"),
projectUserPreference: policies({
  select: owner("userId"),
  insert: and(owner("userId"), inCompany("companyId", "employee")),
  update: { using: owner("userId"), check: and(owner("userId"), inCompany("companyId", "employee")) },
  delete: owner("userId")
}),
projectView: policies({
  select: or(owner("createdBy"), and(where<"projectView">((eb) => eb("isShared", "=", true)), inCompany("companyId", "projects_view"))),
  insert: and(owner("createdBy"), inCompany("companyId", "projects_view")),
  update: { using: owner("createdBy"), check: and(owner("createdBy"), inCompany("companyId", "projects_view")) },
  delete: owner("createdBy")
}),
```

4. If the helper signatures differ, read `packages/database/src/authz/rules.ts` and keep the meaning: owners edit their own rows, and shared views are readable by `projects_view` holders.
5. Run `pnpm db:migrate`, then `pnpm --filter @carbon/database authz migration projects-1b-rls`.
6. Add `projectElementLink` to the `projectElement` entity in `packages/database/src/audit.config.ts`.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit code 0
```

**Out of scope:** hand edits to generated files.

---

## Task 6: Add Capitalize to the posting helpers and the SQL mirror

**Depends on:** 5
**Files:**
- Modify: `packages/server-functions/src/lib/project-posting.ts`
- Modify: `packages/server-functions/src/lib/project-posting.test.ts`
- Create: `packages/database/supabase/migrations/<timestamp>_project-posting-account-capitalize.sql`

**Steps:**
1. Extend the types:
   - `ProjectPostingProject` gains `fixedAssetId: string | null`.
   - `ProjectPostingElement` gains `isFinalAsset: boolean` and `fixedAssetId: string | null`.
   - `ProjectPostingContext` gains `assets: Map<string, { id; status; classAssetAccountId; cipClassAssetAccountId }>`.
2. Extend `loadProjectPostingContexts` to load these assets for every context, in one extra query that joins `fixedAsset` to `fixedAssetClass`:
   - the project's `fixedAssetId`;
   - each final-asset ancestor's `fixedAssetId`.
3. Change `resolveProjectPostingAccount` to return `{ treatment, accountId, fixedAssetId, postCapitalization }`. For Capitalize:
   1. The target asset is the element itself when it is a final asset, else the nearest final-asset ancestor, else `project.fixedAssetId`.
   2. If the target asset is `Under Construction`, return its CIP class `assetAccountId`, the asset id and `postCapitalization: false`.
   3. If the target asset is `Active`, return its current class `assetAccountId`, the asset id and `postCapitalization: true`.
   4. If no target asset exists, or it is in another status, throw `ProjectChargeError("This capital project has no asset under construction. Release the project first.")`.
4. For the other treatments, return `fixedAssetId: null` and `postCapitalization: false`.
5. Add 4 test cases:
   1. A Capitalize project with no final-asset elements returns the project asset's CIP account.
   2. An element under a final-asset branch returns that branch's asset.
   3. An Active branch asset returns the class asset account with `postCapitalization: true`.
   4. A Capitalize project with no asset throws.
6. Run `pnpm db:migrate:new project-posting-account-capitalize`. Replace `project_posting_account` (Phase 1a Task 6) with a version that implements the same Capitalize rule, using the same nearest-final-asset walk. Keep the function signature.
7. Run `pnpm db:migrate`.
8. Run `pnpm run generate:types`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-posting
# Expected: all tests pass, including 4 new ones
```

**Out of scope:** the callers. Tasks 8–11 use the new return fields.

---

## Task 7: Create CIP assets on release and on marking a final asset

**Depends on:** 6
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.server.ts`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.status.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.update.tsx`
- Copy from (precedent): `insertFixedAsset` in `apps/erp/app/modules/accounting/accounting.service.ts` (line 6946)

**Steps:**
1. Add `ensureCapitalAssets(db, { companyId, userId, projectId })` to `projects.server.ts`. In one Kysely transaction:
   1. Load the project. If its treatment is not Capitalize, or it has no `fixedAssetClassId`, return.
   2. If `project.fixedAssetId` is null, insert a `fixedAsset`:
      - `fixedAssetId` from `get_next_sequence('fixedAsset', companyId)`;
      - `name` = `"<identifier> <project name>"`;
      - `fixedAssetClassId` = the project's CIP class;
      - `status` = `'Under Construction'`;
      - `acquisitionCost` = 0;
      - `locationId` = the project's location.

      Then stamp `project.fixedAssetId`.
   3. For every element with `isFinalAsset = true` and `fixedAssetId` null, insert one asset the same way, named `"<readableId> <element name>"`. Stamp `projectElement.fixedAssetId`.
2. Call `ensureCapitalAssets` from the status route after a Release.
3. Call `ensureCapitalAssets` from the update route after `isFinalAsset` turns true on an element of a Released project.
4. Refuse turning `isFinalAsset` off when the element's asset has CIP cost rows. Show the reason.
5. Copy every column `insertFixedAsset` sets, other than the ones above, with its defaults. If `insertFixedAsset` sets a required column whose value you cannot derive, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** deleting assets when a project is cancelled.

---

## Task 8: Write CIP cost rows from the project posting paths

**Depends on:** 6
**Files:**
- Create: `packages/server-functions/src/lib/project-cip.ts`
- Create: `packages/server-functions/src/lib/project-cip.test.ts`
- Modify: `packages/server-functions/src/post-timesheet/index.ts`
- Modify: `packages/server-functions/src/post-project-issue/index.ts`
- Modify: `packages/server-functions/src/post-receipt/index.ts`
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts`
- Modify: `packages/server-functions/src/post-charge/post-charge-post.ts`
- Modify: `packages/server-functions/src/post-reimbursement/post-reimbursement-post.ts`

**Steps:**
1. In `project-cip.ts`, export `buildProjectCipRow({ resolved, companyId, userId, projectId, projectElementId, sourceType, sourceDocumentId, sourceDocumentLineId, amount, costDate, journalId })`.
   - It returns null when `resolved.fixedAssetId` is null.
   - Otherwise it returns an `Insertable<DB["fixedAssetCipCost"]>` with `postCapitalization` from `resolved`.
2. Export `assetCostIncrements(rows)`. It returns a `Map<fixedAssetId, number>` of the amount to add to `acquisitionCost`. A row adds its amount when the asset is Under Construction, or when `postCapitalization` is true.
3. In each poster listed above, where the Phase 1a project branch builds its `projectLedger` row:
   1. Build the CIP row with the matching `sourceType`: `Timesheet`, `Project Issue`, `Receipt`, `Purchase Invoice`, `Charge` or `Reimbursement`.
   2. Insert the CIP rows after the journal, so each carries `journalId`, as `post-receipt` lines 2464–2474 do today.
   3. Raise each touched asset's `acquisitionCost` by its increment. Use one `UPDATE … FROM (VALUES …)`, not one statement per asset.
4. In `post-receipt` and `post-purchase-invoice`, keep the existing Fixed Asset line CIP path unchanged. Add rows only for project-routed lines.
5. Write `project-cip.test.ts` with 3 cases:
   1. A non-Capitalize result returns null.
   2. An Under Construction asset gives a row with `postCapitalization: false`.
   3. `assetCostIncrements` sums 2 rows for one asset.
6. Add one `databaseTest` to `post-timesheet.test.ts` for 10 h at 85.00 on a Capitalize element. Expect:
   - a debit of 850.00 to the element's CIP account;
   - a `Timesheet` CIP row with `projectElementId`;
   - the asset's `acquisitionCost` raised by 850.00.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-cip post-timesheet post-project-issue post-receipt post-purchase-invoice post-charge post-reimbursement
# Expected: all tests pass
```

**Out of scope:** jobs (Task 9).

---

## Task 9: Charge Capitalize jobs through `job.fixedAssetId`

**Depends on:** 6, 7
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobForm.tsx`
- Modify: `apps/erp/app/modules/production/production.models.ts` — the job refine from Phase 1a Task 41
- Modify: `apps/erp/app/routes/x+/job+/new.tsx`
- Modify: `packages/server-functions/src/issue/index.ts`
- Modify: `packages/server-functions/src/post-production-event/index.ts`
- Create: `packages/database/supabase/migrations/<timestamp>_complete-job-cip-project.sql`

**Steps:**
1. In `JobForm`, when the picked charge number's treatment is Capitalize:
   - turn **Consume to project** off and disable it;
   - set `fixedAssetId` to the element's target CIP asset (Task 6 rule), read through the charge number options.
2. Add `costTreatment` and `targetFixedAssetId` to the `getChargeNumbers` rows (Phase 1a Task 31).
3. Change the Phase 1a refine: `consumeToProject` is refused for a Capitalize charge number. `fixedAssetId` is allowed together with a charge number.
4. In `job+/new.tsx`, pass `fixedAssetId` to `insertJob` from the form.
5. In `issue` and `post-production-event`: when the job has `projectId`, `consumeToProject` false and `fixedAssetId` set, keep the WIP debit unchanged. Write a `projectLedger` row for each cost, with `journalLineId` = the WIP line. The project then sees the cost as it is incurred.
6. Run `pnpm db:migrate:new complete-job-cip-project`.
7. Copy the latest `complete_job_to_inventory` (from Phase 1a Task 20's migration). In the `v_asset_target = 'asset'` branch (originally lines 1068–1081), add `"projectId"` and `"projectElementId"` from the job to the `fixedAssetCipCost` insert.
8. Do not write a second `projectLedger` row at the sweep. The ledger already has the cost from step 5.
9. Run `pnpm db:migrate`, then `pnpm run generate:types`.
10. Add a `databaseTest` in `packages/server-functions/src/issue/project-issue.test.ts`:
    1. A job charged to a Capitalize element issues 3 units at 10.00 (Dr WIP 30.00) and writes a 30.00 `projectLedger` row.
    2. Completing the job writes a `Job` CIP row of 30.00 with the element id.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- project-issue issue post-production-event
# Expected: all tests pass
```

**Out of scope:** `attachJob` from the fixed asset page. It keeps working unchanged.

---

## Task 10: Add Place in service

**Depends on:** 6, 7
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.place-in-service.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/PlaceInServiceModal.tsx`
- Modify: `apps/erp/app/modules/projects/projects.server.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.capitalize.tsx`, `apps/erp/app/modules/accounting/ui/FixedAssets/FixedAssetCapitalizeCipForm.tsx`

**Steps:**
1. `PlaceInServiceModal` copies `FixedAssetCapitalizeCipForm`:
   - a target class `Combobox` (non-CIP classes only, read with a direct query, not `getFixedAssetClassesList`, because of the CIP flag);
   - an in-service date (`DatePicker`);
   - a preview of the CIP total (`getFixedAssetCipCosts`) and the journal.
2. Open it from **Place in service** on:
   - a final-asset element's page (that element's asset);
   - the project header, with one row per Under Construction asset of the project, including the project's own asset.
3. The route action runs `requirePermissions(request, { update: ["projects", "accounting"] })`. If the array form is not supported, call `{ update: "accounting" }` and check `permissions.can("update", "projects")`.
4. For each selected asset, the action:
   1. Calls `invokeAssetTransfer(client, getDatabaseClient(), { type: "capitalizeCip", fixedAssetId, toClassId, inServiceDate })`.
   2. On success, moves the element and its descendants to the project's default Completed state, with `updateProjectElementField`. For the project's own asset, move no element.
5. Show each capitalize error in the modal. Leave the assets that succeeded capitalized.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** reversing a capitalization.

---

## Task 11: Post late costs to the Active asset and fix the void guards

**Depends on:** 8
**Files:**
- Modify: `packages/server-functions/src/post-receipt/index.ts` — the void guard (lines 778–788)
- Modify: `packages/server-functions/src/post-purchase-invoice/index.ts` — the void guard (lines 207–216)
- Modify: `packages/server-functions/src/lib/project-cip.test.ts`

**Steps:**
1. Tasks 6 and 8 already post the late cost. An Active target asset resolves to its class asset account with `postCapitalization: true`, and the CIP row carries the flag. Confirm that the Task 8 test file has a case for it. If it does not, add one.
2. Change both void guards. They must refuse a void only when a CIP row of that document has `postCapitalization = false` and the asset is no longer Under Construction.
3. A void of a late-cost document deletes its `postCapitalization` rows and lowers `acquisitionCost` by their sum. This already happens for Under Construction assets at lines 924–937; extend that path to Active assets for `postCapitalization` rows only.
4. Add a `databaseTest` to `post-purchase-invoice/project-invoice.test.ts`:
   1. An invoice for a Capitalize element whose asset is Active debits the class asset account and writes a `postCapitalization` row.
   2. Voiding that invoice deletes the row and lowers `acquisitionCost`.

**Verify:**
```bash
pnpm --filter @carbon/server-functions test -- post-receipt post-purchase-invoice project-cip
# Expected: all tests pass
```

**Out of scope:** depreciation catch-up for the months before the late cost. Task 12 spreads the addition forward.

---

## Task 12: Move Straight Line depreciation to a remaining-life basis

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.utils.ts` — book Straight Line (lines 553–561) and tax Straight Line (lines 676–680)
- Modify: `apps/erp/app/modules/accounting/accounting.utils.test.ts`

**Steps:**
1. Replace the book Straight Line branch with this:

```ts
case "Straight Line": {
  const from = lastPostedPeriodEnd ? addOneMonth(lastPostedPeriodEnd) : startDate;
  const monthsToDepreciate = getMonthsBetween(from, periodEndDate);
  let total = 0;
  let remaining = remainingDepreciable;
  for (let i = 0; i < monthsToDepreciate; i++) {
    const remainingMonths = Math.max(
      1,
      asset.usefulLifeMonths - getMonthsElapsed(startDate, periodEndDate) + monthsToDepreciate - i
    );
    const monthly = remaining / remainingMonths;
    total += monthly;
    remaining -= monthly;
  }
  return Math.min(round(total, decimalPlaces), remainingDepreciable);
}
```

2. Make the same change to the tax branch, with the tax life and the tax remaining amount.
3. Use the declining-balance branch's `remainingMonths` expression (lines 573–578) as the model. If its month arithmetic differs from the code above, copy its exact form.
4. Fix the test at lines 672–682. It passes `accumulatedDepreciation: 0` with `lastPostedPeriodEnd: "2025-01-31"`, which no real run produces. Give it the accumulated amount a real run would have at that date. Keep the expected 3600.
5. Add 3 tests:
   1. **No additions:** for an asset with no additions, every month of a 60-month life equals the old formula's amount, within 0.01. Loop over all 60 months with `buildDepreciationLines`.
   2. **Book addition:** an asset of 120,000 with a 60-month life gets an addition of 6,000 after 24 months. The next month's amount is (120,000 − 48,000 + 6,000) ÷ 36 = 2,166.67.
   3. **Tax addition:** the same case on the tax branch.
6. If an existing test other than lines 672–682 fails, STOP and report. Do not change other expected values.

**Verify:**
```bash
pnpm --filter erp test -- accounting.utils
# Expected: all tests pass
```

**Out of scope:** Declining Balance and Units of Production. They already work on the remaining value.

---

## Task 13: Add the capital project fields to the project and element UI

**Depends on:** 7, 10
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — offer `Capitalize`; add `fixedAssetClassId` to `projectValidator` (a refine makes it required for Capitalize); add `isFinalAsset` to the element field updates
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — add `getCipFixedAssetClasses(client, companyId)`, which reads `fixedAssetClass` where `isConstructionInProgress = true` directly
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectHeader.tsx`

**Steps:**
1. In `ProjectForm`, when the treatment is Capitalize, show a **CIP class** select fed by `getCipFixedAssetClasses`.
2. In `ElementSidebar`, add a **Final asset** switch (Capitalize projects only). When on, show the asset link and its status (Under Construction or Active).
3. In `ProjectHeader`, add **Place in service** (Task 10) for Capitalize projects with at least one Under Construction asset.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** changing `CONSTRUCTION_IN_PROGRESS_ENABLED`.

---

## Task 14: Add the trace link and suspect service functions

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Create: `apps/erp/test/projects-links.test.ts`

**Steps:**
1. Add `projectElementLinkTypes` from the generated enum. Add `linkReverseLabel` with these labels:

| Link type | Reverse label |
|---|---|
| satisfies | satisfied by |
| verifies | verified by |
| derives | derived from |
| implements | implemented by |
| blocks | blocked by |
| precedes | follows |
| relates to | relates to |
| feeds | fed by |

2. Add `allowedLinkEnds: Record<LinkType, { from: ElementType[]; to: ElementType[] }>`:

| Link type | From | To |
|---|---|---|
| satisfies | System, Function | Requirement |
| verifies | Test Case | Requirement |
| derives | Requirement | Requirement |
| implements | Task | System, Function, Requirement |
| blocks, precedes, relates to | any type | any type |
| feeds | Parameter | Parameter |

3. Add a pure function `canLink(from, to, type, existingLinks)`. It refuses:
   - a `feeds` link: only the formula save (Task 15) writes them;
   - a self link;
   - ends that `allowedLinkEnds` does not allow;
   - a duplicate;
   - a cycle among `precedes` links.
4. Add `projectElementLinkValidator`: `fromElementId`, `toElementId`, `linkType`.
5. Add `getProjectElementLinks(client, projectId, companyId)`, `upsertProjectElementLink` (it checks `canLink` first, with the project's links loaded once), `deleteProjectElementLink` and `clearSuspectLink(client, { id, companyId, userId })`, which sets `suspectSince` null, `reviewedAt` and `reviewedBy`.
6. In `updateProjectElementField` (Phase 1a Task 13), when `field` is `name`, `description`, `targetOperator`, `targetValue`, `targetUpperValue`, `targetUnit`, `parameterValue` or `parameterUnit`:
   - set `suspectSince` to now on every link whose `toElementId` is in `ids` and whose `linkType` is not `feeds`, in one update. Formula values recompute live, so a `feeds` link never turns suspect.
7. Write `apps/erp/test/projects-links.test.ts` with 5 cases for `canLink`:
   1. A Test Case verifies a Requirement: allowed.
   2. A Task verifies a Requirement: refused.
   3. A self link: refused.
   4. A duplicate: refused.
   5. `precedes` A→B, B→C, then C→A: refused (cycle).
   6. A user-made `feeds` link: refused.

**Verify:**
```bash
pnpm --filter erp test -- projects-links
# Expected: 6 passed
```

**Out of scope:** links between projects.

---

## Task 15: Add the Requirement, Test Case and Parameter fields and the verification read

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts`
- Modify: `apps/erp/app/modules/projects/projects.service.ts`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — add `saveParameterFormula`
- Create: `apps/erp/test/projects-verification.test.ts`
- Create: `apps/erp/test/projects-formula.test.ts`

**Steps:**
1. Add these fields to `projectElementFieldUpdateValidator`'s editable field list: `requirementCategory`, `targetOperator`, `targetValue`, `targetUpperValue`, `targetUnit`, `verificationMethod`, `actualParameterId`, `qualityDocumentId`, `verdict`, `parameterValue`, `parameterUnit`, `parameterSource`, `parameterItemField`, `parameterContingencyPercent`, `allocationPercent`. `parameterFormula` is not in this list: it saves through `saveParameterFormula` (step 5).
2. In `updateProjectElementField`:
   - when `field` is `verdict`, set `verdictAt` to now and `verdictBy` to the user;
   - refuse a type-specific field on an element of another type (for example `verdict` on a Task).
3. Add a pure function `parseParameterFormula(text)` in `projects.models.ts`. It returns `{ ast, refs }` or `{ error }`:
   1. The text must start with `=`.
   2. Tokens: numbers (`12`, `0.5`), readable ids (`[A-Z][A-Z0-9]*-\d+`, which also matches a Service project's `SVC000123-4`), `+ - * /`, `(` `)`, `,`, and the function names `min`, `max`, `abs`. Any other character is an error that names its position.
   3. Parse with a recursive-descent parser: expression → term (`+ -`) → factor (`* /`) → unary minus → primary (number, id, call, parenthesis). `min` and `max` take 1 or more arguments; `abs` takes 1.
   4. `refs` is the list of distinct readable ids.
   5. Never use `eval`, `Function` or a dependency.
4. Add `evaluateFormula(ast, valueOf)`. `valueOf(readableId)` returns a number or null. A null input or a division by zero gives null with a reason.
5. Add `saveParameterFormula(db, { companyId, userId, elementId, formula })` in `projects.server.ts`. In one Kysely transaction:
   1. Parse the formula. If it fails, return the parse error.
   2. Load the project's Parameters by readable id with one query. Refuse a ref that is missing or not a Parameter.
   3. Refuse a cycle: walk the `feeds` links of the project plus the new refs, and refuse when the walk reaches the element itself.
   4. Update `parameterFormula` and set `parameterSource` to `Formula`.
   5. Delete the element's incoming `feeds` links, then insert one `feeds` link from each ref to the element.
6. Add a pure function `computeVerification(elements, links, itemValues)` in `projects.models.ts`. `itemValues` maps `itemId` to `{ unitCost, customFields }` for the linked parts (Task 27 loads it). It returns a map by element id. For a Parameter:
   1. `computedValue` by source:
      - Manual: `parameterValue`;
      - Sum, Min, Max: the `computedValue` of the direct child Parameters whose `parameterUnit` equals the parent's;
      - Formula: `evaluateFormula` with the `computedValue` of the referenced Parameters;
      - Item: from the nearest element at or above the Parameter that has an `itemId`. `parameterItemField` is `unitCost` or a custom field id; a non-numeric value gives null with a reason.
   2. Compute in dependency order: child Parameters before their parent, and `feeds` sources before the formula. If the order has a cycle, give the cycle's Parameters null with the reason "Circular formula".
   3. `mixedUnits` is true when a roll-up skipped a child with another unit, or when a formula adds or subtracts Parameters with different units.
   4. `checkedValue`: without contingency, `computedValue`. With contingency c, the Requirement comparison (below) uses `computedValue × (1 + c)` for `≤`, `computedValue × (1 − c)` for `≥`, and both for `=` and Range.
   5. `budgetValue` = `allocationPercent` × the parent Parameter's `computedValue`, and `budgetPass` = `checkedValue <= budgetValue` (the `≤` form).

   For a Requirement:
   1. `targetPass` compares the checked value of `actualParameterId` with the target: `≤`, `≥`, `=`, or Range (target ≤ value ≤ upper). It is null when there is no target, no parameter, or a null value.
   2. `anyTestFail` is true when a Test Case that `verifies` it has verdict Fail.
   3. `checkCount` counts the target check (when not null) plus the verifying Test Cases with a verdict other than Not Run.
   4. Own status: Fail if `targetPass` is false or `anyTestFail`; Pass if `checkCount` > 0 and nothing failed; else Unverified.
7. Add a pure function `rollUpRequirementStatus(tree, verification)`. It returns a map by element id:
   - A Requirement with child Requirements is Pass only if its own status is Pass or Unverified with no checks, and every child Requirement is Pass.
   - It is Fail if its own status is Fail, or any child is Fail.
   - Otherwise it is Unverified.
8. Add a pure function `formatAllocation(budgetValue, allocationPercent, parentValue, unit)`. It returns `"≤ 600 kg (30.0 % of 2,000 kg)"`. Use `formatQuantity` and the percent formatter from `@carbon/utils`.
9. Write `apps/erp/test/projects-verification.test.ts`:
   1. A Sum Parameter with Manual children 50 g and 65 g computes 115; a child in "lb" is skipped and sets `mixedUnits`.
   2. A Requirement `≤ 120 g` on that Parameter is Pass; at 125 it is Fail.
   3. A verifying Test Case with verdict Fail makes it Fail.
   4. A parent Requirement with 2 Pass children and no own check is Pass.
   5. One Fail child makes the parent Fail.
   6. A child with no checks makes the parent Unverified.
   7. `formatAllocation(600, 0.3, 2000, "kg")` returns `"≤ 600 kg (30.0 % of 2,000 kg)"`.
   8. The spec's constraint: `SNS-20` = 50 W, `SNS-21` = 42 W, and `SNS-22` with `= SNS-20 - SNS-21` computes 8. A Requirement `≥ 0 W` on it is Pass. At `SNS-21` = 55 it is −5 and Fail.
   9. Two formulas that refer to each other both give null with "Circular formula".
   10. Contingency: 115 g with 10 % gives a checked value of 126.5 against `≤ 120 g`, so Fail. Against a `≥ 100 g` target it checks 103.5, so Pass.
   11. An Item Parameter under an element whose item has the custom field value 118 computes 118.
10. Write `apps/erp/test/projects-formula.test.ts`:
   1. `= SNS-7 - SNS-9` parses with refs `["SNS-7", "SNS-9"]`.
   2. `= max(SNS-3, SNS-4) * 1.2` evaluates to 24 when the values are 10 and 20.
   3. `= -(2 + 3) / 5` evaluates to −1.
   4. `= SNS-1 / 0` gives null with a reason.
   5. `= SNS-1; drop` is a parse error at position 7.
   6. `SNS-1 + 1` (no `=`) is a parse error.

**Verify:**
```bash
pnpm --filter erp test -- projects-verification projects-formula
# Expected: 17 passed
```

**Out of scope:** automatic verdicts from inspections; unit conversion.

---

## Task 16: Add the trace link, verification and parameter sections to the element page

**Depends on:** 14, 15
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Element/ElementLinks.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/ElementTypeBlock.tsx`
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.links.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementView.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementList.tsx` — add a verification pill for Requirements and a suspect badge
- Copy from (precedent): `apps/erp/app/modules/production/ui/Schedule/Kanban/components/JobCard.tsx` (~243, amber triangle with a tooltip for the suspect badge); `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` (~2259, number with unit inputs)

**Steps:**
1. `ElementTypeBlock` renders by type:
   - **Requirement:**
     - target operator select, target value (and upper value for Range), unit (a free-text input);
     - verification method select;
     - actual parameter select (Parameters of the project);
     - the status pill (Pass, Fail, Unverified) from `rollUpRequirementStatus`.
   - **Test Case:** verdict select, the linked quality procedure (`qualityDocumentId`, a combobox of quality documents), and "Last run by X on date".
   - **Requirement** also has a category select.
   - **Parameter:**
     - source select; value (Manual only); unit;
     - the formula input (Formula only), which shows each readable id as a link and the parse error under the input;
     - the item field select (Item only): **Unit cost** plus the item's numeric custom fields;
     - allocation % and contingency % (percent inputs with `INPUT_FORMAT` and `INPUT_STEP` from `@carbon/utils`);
     - the computed value, the checked value when a contingency is set, `formatAllocation`, and a Pass/Fail pill.
2. Each field posts to the update route. The formula posts to the links route with `intent = saveFormula`, which calls `saveParameterFormula`.
3. `ElementLinks` lists the element's links grouped by direction and type ("Verified by", "Satisfies"). Each row shows the other element's readable id, type icon, name and state, plus an amber suspect triangle with a **Mark reviewed** action.
4. **Add link** opens a combobox of the project's elements, filtered by `allowedLinkEnds`, and a type select.
5. The links route action switches on `intent`: `upsert`, `delete`, `clearSuspect`, `saveFormula`. It requires `update: "projects"`. `ElementLinks` lists `feeds` links read-only, with no delete action.
6. Load the links in the Elements route loader once. Compute `computeVerification` and `rollUpRequirementStatus` from the loaded elements and links, and pass the results down.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** bulk link editing.

---

## Task 17: Build the Tree layout

**Depends on:** 14
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementGraph.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/ElementNode.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/LinkEdge.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/layout.ts`
- Create: `apps/erp/app/modules/projects/ui/Elements/graph/store.ts`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — render it when `layout=tree`; add the React Flow stylesheet to `links`
- Copy from (precedent):
  - `apps/erp/app/modules/inventory/ui/Traceability/TraceabilityGraph.tsx` (shell, expand/collapse through node data, `GraphToolbar`, `NodeSearchDialog`)
  - `apps/erp/app/modules/workflows/ui/Builder/WorkflowBuilder.tsx`, `store.ts` (~190, `onConnect`), `graph.ts` (`canConnect`), `handles.tsx` (`handleClass()`)
  - `apps/erp/app/routes/x+/traceability+/graph.tsx` (stylesheet link and `ReactFlowProvider`)

**Steps:**
1. Nodes are the elements. Each `ElementNode` card shows:
   - the type icon and label, the readable id and the name;
   - the state icon and, for a Requirement, a verification pill;
   - an amber outline when an incoming link is suspect.
2. Edges come from two sources:
   - the parent link: a solid grey edge, no label;
   - each trace link: a `LinkEdge` with the link type as its label, dashed for `relates to`, dotted for `feeds`, and amber when suspect.
3. `layout.ts` runs dagre left to right, synchronously, with fixed node sizes. Use parent links only for ranks, so the tree reads left to right, and draw trace links on top.
4. Expand and collapse a node's subtree through node data callbacks, as Traceability does. Store the collapsed ids and the direction in `store.ts` with zustand `persist`, key `project-graph:<projectId>`.
5. A node click navigates to the element peek (`path.to.projectElement`).
6. Drag from a node handle to another node to add a link:
   1. Use visible handles (`handleClass()`).
   2. In `isValidConnection`, call `canLink` (Task 14).
   3. In `onConnect`, open a small popover to pick the link type (filtered by `allowedLinkEnds`), then post to the links route.
7. Wrap the canvas in `ReactFlowProvider`, inside `ClientOnly`.
8. Add a toolbar with these controls:
   - fit view;
   - the direction toggle (left to right or top to bottom);
   - search (`NodeSearchDialog` pattern);
   - a legend of the link types.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** dragging nodes to change the parent.

---

## Task 18: Build the Timeline layout

**Depends on:** 14
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementTimeline.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/timeline-geometry.ts`
- Create: `apps/erp/test/projects-timeline-geometry.test.ts`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — render it when `layout=timeline`
- Copy from (precedent): `apps/erp/app/components/TreeView` (`useTree` rows); `apps/erp/app/modules/production/ui/Schedule/resourceTimeline.ts` (building rows from records)

**Steps:**
1. 🛑 Do not change `apps/erp/app/components/Gantt/Gantt.tsx`. It has no dependency arrows and no drag, and scheduling owns it. Build a smaller component in the projects module.
2. `timeline-geometry.ts` exports pure functions:
   - `dayIndex(date, windowStart)`: the whole days between two `YYYY-MM-DD` strings, with `@internationalized/date`.
   - `barRect(element, windowStart, dayWidth, rowIndex, rowHeight)`: `{ x, y, width, height }` from `startDate` and `targetDate`. An element with only one date gets a 1-day bar. An element with no date gets no bar.
   - `arrowPath(fromRect, toRect)`: an SVG path from the right end of the "from" bar to the left end of the "to" bar, with one elbow.
   - `defaultWindow(elements)`: from the earliest start minus 3 days to the latest target plus 7 days.
3. `ElementTimeline` has two panes:
   - a left pane of 360 px with the tree rows (readable id, type icon, name);
   - a right pane with day columns (week labels on top), bars coloured by state, and an SVG layer drawing one arrow per `precedes` link.

   Rows are 44 px high. A zoom select sets the day width: Day (40 px), Week (12 px), Month (4 px).
4. A bar click opens the peek. Both panes scroll vertically together.
5. Write `projects-timeline-geometry.test.ts` with 4 cases:
   1. `dayIndex("2026-10-08", "2026-10-01")` = 7.
   2. `barRect` for start 2026-10-03 and target 2026-10-05 at day width 40 gives x = 80 and width = 120.
   3. An element with only `targetDate` gets a 1-day bar.
   4. `arrowPath` starts at the from-bar's right edge.

**Verify:**
```bash
pnpm --filter erp test -- projects-timeline-geometry
# Expected: 4 passed
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** drag to reschedule; the critical path.

---

## Task 19: Build the Reader layout

**Depends on:** 14
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Elements/ElementReader.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` — render it when `layout=reader`
- Copy from (precedent): `apps/erp/app/modules/quality/ui/Issue/IssueContent.tsx` (~73, `generateHTML` with `prose`)

**Steps:**
1. Render the filtered elements in tree order as one document:
   - a heading per element, with level = tree level + 2, capped at h6, showing the outline number (`1.2.3`), the readable id and the name;
   - a small property line (type, state, owner);
   - the description;
   - for a Requirement, its target and status;
   - for a Parameter, its value and allocation;
   - for a Test Case, its verdict.
2. Render the descriptions with `generateHTML` inside `ClientOnly`. `generateHTML` returns `""` on the server.
3. Add a table of contents on the left on wide screens, from the same headings.
4. Add **Export PDF** (Task 20) to the header when `layout=reader`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** editing in the Reader.

---

## Task 20: Add the Reader PDF

**Depends on:** 19
**Files:**
- Create: `packages/documents/src/pdf/ProjectReaderPDF.tsx`
- Modify: `packages/documents/src/pdf/index.ts` — export it
- Modify: `packages/documents/src/pdf/components/Note.tsx` — support the `bold`, `italic` and `link` marks
- Create: `apps/erp/app/routes/file+/project+/$id[.]pdf.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `file.projectReader(id)`
- Copy from (precedent): `apps/erp/app/routes/file+/issue+/$id[.]pdf.tsx`; `packages/documents/src/pdf/blocks/jobTraveler/OperationsBlock.tsx` (one section per record)

**Steps:**
1. In `Note.tsx`'s `makeConvert`, render a `text` node with these marks:
   - `bold`: `fontWeight: "bold"`;
   - `italic`: `fontStyle: "italic"`;
   - `link`: a react-pdf `Link` with `src` = the mark's `href`.

   Keep every other behavior.
2. `ProjectReaderPDF` uses `Template`. It renders one section per element, in tree order, with the same content as Task 19. It uses `Note` for descriptions and `page-break-inside-avoid` on each section.
3. The PDF route:
   1. Runs `requirePermissions(request, { view: "projects" })`.
   2. Loads the project, the elements (with the same filters as the query string), the links and the company. It computes the verification with `computeVerification`.
   3. Renders with `renderToStream`.
   4. Returns `Content-Type: application/pdf` with filename `"<company> - <identifier>.pdf"`.
4. Link **Export PDF** to `path.to.file.projectReader(id)` plus the current filter query string, with `target="_blank"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/documents
# Expected: exit code 0
```

**Out of scope:** document template customization for this PDF.

---

## Task 21: Add saved views and per-user preferences

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `projectViewValidator`, `projectDisplayStateValidator`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `getProjectViews`, `upsertProjectView`, `deleteProjectView`, `getProjectUserPreference`, `upsertProjectUserPreference`
- Create: `apps/erp/app/routes/x+/project+/$projectId.views.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx`

**Steps:**
1. `projectDisplayStateValidator` holds:
   - `layout`;
   - `filters`: type, state group, owner, milestone, label and search;
   - `displayOptions`: shown properties, grouping (Board and Table), and timeline zoom.
2. Replace the Phase 1a `useLocalStorage("project-display-…")` with the database preference:
   1. The Elements loader reads `projectUserPreference` for the user and project.
   2. Query string values override it.
   3. Each change in the Display menu, layout switcher or filter row posts `intent: "savePreference"` with a debounce of 1 s.
3. Add a **Views** menu to `ElementsHeader`:
   - the user's own views and shared views;
   - **Save view** (name, shared switch);
   - **Update view**;
   - **Delete**.

   Selecting a view applies its state and sets `?view=<id>`.
4. The views route action switches on `intent`: `savePreference`, `upsertView`, `deleteView`. It requires `view: "projects"`. RLS limits writes to the owner.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** views shared across projects.

---

## Task 22: Add project templates

**Depends on:** 14, 15
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — add `copyProject(db, args)`
- Modify: `apps/erp/app/routes/x+/projects+/new.tsx` — add **Copy from**
- Modify: `apps/erp/app/modules/projects/ui/Projects/ProjectForm.tsx` — a **Copy from** select (projects with `isTemplate`, plus any project)
- Modify: `apps/erp/app/modules/projects/ui/Project/ProjectHeader.tsx` — a **Template** switch in the menu
- Create: `apps/erp/test/projects-copy.test.ts`
- Copy from (precedent): `copyAssemblyInstructionAsVersion` in `apps/erp/app/modules/production/production.service.ts` (lines 7308–7324, the id map); `get-method` `makeMethodToMakeMethod` (transaction)

**Steps:**
1. Add a pure function `planProjectCopy(source, newProjectId, identifier, makeId)` in `projects.models.ts`. It returns the rows to insert, with new ids from `makeId`:
   - the states, with an old→new map;
   - the labels;
   - the milestones;
   - the elements, with sequence and readable id renumbered from 1 in the source's sequence order, `parentId`, `stateId`, `milestoneId` and `actualParameterId` remapped, and `fixedAssetId` cleared;
   - the element labels;
   - the links, with both ends remapped and `suspectSince` cleared;
   - every `parameterFormula`, with each readable id rewritten to the new element's readable id (use `parseParameterFormula` refs and replace whole tokens only);
   - the plan lines (materials, labor, other costs).

   It sets `nextElementSequence` to the element count + 1.
2. `copyProject(db, { companyId, userId, sourceProjectId, name, identifier, … })`:
   1. Loads every source row with one query per table.
   2. Calls `planProjectCopy` with `nanoid`.
   3. Inserts all rows in one Kysely transaction, in FK order: project, states, labels, milestones, elements (parent first), element labels, links, plan lines.
3. The copy is a Draft project. Charges, ledger rows, timesheets, comments, views, preferences and CIP assets are not copied.
4. Write `projects-copy.test.ts` for `planProjectCopy` with 3 cases:
   1. A 3-level tree keeps its shape with new ids, and children point at the new parents.
   2. A link's ends point at the new elements.
   3. Readable ids restart at `NEW-1` in sequence order.
   4. A formula `= SNS-20 - SNS-21` becomes `= NEW-3 - NEW-4` when those elements renumber to 3 and 4.

**Verify:**
```bash
pnpm --filter erp test -- projects-copy
# Expected: 4 passed
```

**Out of scope:** copying between companies.

---

## Task 23: Add Create Job from a plan-line material

**Depends on:** 5
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.$elementId.create-job.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementPlanLines.tsx` — a **Create job** row action for Make to Order materials without a job
- Copy from (precedent): `insertJob` in `apps/erp/app/modules/production/production.service.ts` (line 3595); `apps/erp/app/routes/x+/job+/new.tsx` (line 172 and the `requireCompanyRecord` checks at lines 109–134)

**Steps:**
1. The modal asks for quantity (default the plan-line quantity minus issued), due date (default the plan line's required date), and location (default the project location).
2. The action:
   1. Runs `requirePermissions(request, { create: "production", view: "projects" })`.
   2. Calls `insertJob(client, getDatabaseClient(), { itemId, quantity, dueDate, deadlineType: dueDate ? "Soft Deadline" : "No Deadline", locationId, unitOfMeasureCode: <the item's unit>, projectId, projectElementId, consumeToProject, fixedAssetId, companyId, createdBy })`.
   3. Sets `consumeToProject` true for Expense or Contract, and false for Capitalize (with `fixedAssetId` from the charge number, Task 9).
   4. Stamps `projectElementMaterial.jobId` with the new job id.
   5. Redirects to the job.
3. If `insertJob` does not accept `projectId`, `projectElementId` or `consumeToProject` after Phase 1a, add them to its input type and pass them through to the insert. If it already builds the insert row field by field, add the three fields there.
4. Pass `source: "erp"` to `insertJob`'s telemetry.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** MRP-created jobs for plan lines (Phase 2).

---

## Task 24: Add Create PO line from a plan-line material

**Depends on:** 5
**Files:**
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.$elementId.create-po-line.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementPlanLines.tsx` — a **Create PO line** row action for Purchase to Order materials without a PO line
- Copy from (precedent): `apps/erp/app/routes/x+/purchasing+/planning.update.tsx` (lines 404–417 PO lookup, 556–695 supplier part, price and line insert); `insertPurchaseOrder` and `upsertPurchaseOrderLine` in `purchasing.service.ts`

**Steps:**
1. The modal asks for:
   - the supplier (default `itemReplenishment.preferredSupplierId`);
   - the quantity (default the plan-line quantity minus issued);
   - the required date (default the plan line's required date);
   - **Add to** a Draft PO of that supplier at the project location, or **New PO**.
2. The action:
   1. Runs `requirePermissions(request, { create: "purchasing", view: "projects" })`.
   2. Reads the `supplierPart` for (item, supplier): `unitPrice`, `supplierUnitOfMeasureCode`, `conversionFactor`, `minimumOrderQuantity`. It raises the quantity to the minimum.
   3. Uses the chosen Draft PO, or creates one with `insertPurchaseOrder(client, { status: "Draft", supplierId, purchaseOrderType: "Purchase", currencyCode, locationId, companyId, companyGroupId, createdBy })`.
   4. Creates the line with `upsertPurchaseOrderLine`, with `projectId` and `projectElementId`.
   5. Stamps `projectElementMaterial.purchaseOrderLineId`.
   6. Redirects to the PO.
3. List the supplier's Draft POs at the location in the modal's loader, with one query.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** merging with planning POs (`createdFromPlanning`).

---

## Task 25: Add charge numbers to reimbursement lines and show them on charges

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/components/DocumentLineEditor/types.ts` — add `projectElementId` to `ClientDocumentLine`
- Modify: `apps/erp/app/components/DocumentLineEditor/DocumentLineEditor.tsx` (lines 127–140) — serialize `projectElementId`
- Modify: `apps/erp/app/components/DocumentLineEditor/DocumentLineRow.tsx` — add `ChargeNumber` after the `DimensionSelector` block (lines 96–104)
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — `reimbursementLineValidator` (lines 631–641): add `projectElementId`
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — `upsertReimbursementLines` (line 1651; insert at lines 1690–1704)
- Modify: `apps/erp/app/routes/x+/reimbursements+/$reimbursementId.edit.tsx` (lines 220–250) — hydrate `projectElementId`
- Modify: `apps/erp/app/routes/x+/invoicing+/charges.$id.tsx` — show a read-only Charge number column

**Steps:**
1. In `DocumentLineRow`, render `ChargeNumber` when the editor gets a `showChargeNumber` prop. `ReimbursementEditForm` passes it.
2. Write both `projectId` and `projectElementId` from the picker.
3. 🛑 Posting already turns `projectId` into a Project dimension and unions it with the line's `dimensions` (`post-reimbursement-post.ts`). If the user also picked a Project value in `DimensionSelector`, the line would carry two Project tags.
   - In `DocumentLineRow`, hide the Project entity from `DimensionSelector` when `showChargeNumber` is on.
   - If posting already deduplicates the Project dimension, keep it; otherwise dedupe there by `dimensionId`.
4. On the charge page, show the line's project identifier and element readable id, read-only. Editing charge lines is out of scope (`.ai/specs/2026-09-23-editable-imported-spend-documents.md`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
pnpm --filter @carbon/server-functions test -- post-reimbursement
# Expected: all tests pass
```

**Out of scope:** the Ramp sync. It still writes `projectId` only.

---

## Task 26: Add the milestone burn chart

**Depends on:** 5
**Files:**
- Create: `apps/erp/app/modules/projects/ui/Milestones/MilestoneBurnChart.tsx`
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — add `buildBurnSeries`
- Modify: `apps/erp/app/routes/x+/project+/$projectId.milestones.tsx`
- Create: `apps/erp/test/projects-burn.test.ts`
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/ItemCostHistoryChart.tsx` (~208); `ItemPlanningChart.tsx` (723–762, dashed lines)

**Steps:**
1. Add a pure function `buildBurnSeries({ startDate, endDate, plannedHours, entries })`. It returns one point per day with:
   - `actual`: cumulative posted hours of the milestone's elements up to that day;
   - `ideal`: `plannedHours × (day index ÷ number of days)`.

   Dates are `YYYY-MM-DD` strings, and day arithmetic uses `@internationalized/date`.
2. `MilestoneBurnChart` renders a `ChartContainer` with a `LineChart`:
   - `actual` as a solid line;
   - `ideal` as `<Line strokeDasharray="4 4" />`;
   - a `ReferenceLine` at today.
3. Show the chart in a side panel when a milestone row is selected. Load the milestone's posted timesheet entries in one query (`.in("projectElementId", elementIds)`).
4. Write `projects-burn.test.ts` with 2 cases:
   1. A 10-day milestone with 100 planned hours has `ideal` = 50 on day 5.
   2. Entries of 4 h on day 1 and 6 h on day 3 give `actual` = 4 on day 2 and 10 on day 3.

**Verify:**
```bash
pnpm --filter erp test -- projects-burn
# Expected: 2 passed
```

**Out of scope:** cost burn. This chart shows hours only.

---

## Task 27: Add part links and item values

**Depends on:** 5, 15
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts`, `projects.service.ts`
- Create: `apps/erp/app/modules/projects/ui/Element/PartLink.tsx`
- Create: `apps/erp/app/modules/projects/ui/Element/SerialSelect.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementSidebar.tsx` (Phase 1a Task 35)
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementTypeBlock.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Element/IssueMaterialModal.tsx` (Phase 1a Task 36)
- Modify: `apps/erp/app/routes/x+/project+/$projectId.elements.tsx` (loader)
- Copy from (precedent): `Item` (`apps/erp/app/components/Form/Item.tsx:135`); `useSerialNumbers` (`apps/erp/app/modules/inventory/ui/Shipments/ShipmentLines.tsx:1513`) and `path.to.api.serialNumbers` (`apps/erp/app/utils/path.ts:295`)

**Steps:**
1. Add `itemId` and `trackedEntityId` to the editable fields of `projectElementFieldUpdateValidator`. Refuse both on a Parameter. Setting `itemId` clears `trackedEntityId`.
2. `SerialSelect` is a combobox of serials for one item. It reads `path.to.api.serialNumbers(itemId)` through `useSerialNumbers`. No serial combobox exists in `~/components/Form` today.
3. `PartLink` is a property pill: the `Item` picker (`validItemTypes` = every type), then `SerialSelect` when the item's tracking type is Serial. A linked element shows the item's thumbnail, readable id and revision, with a link to the item page.
4. Add `getProjectItemValues(client, companyId, itemIds)` in `projects.service.ts`. It returns `Map<itemId, { unitCost, customFields }>` with at most 6 queries, never one per element:
   1. `item` rows (`id`, `readableId`, `type`) with `.in("id", itemIds)`.
   2. `itemCost.unitCost` with `.in("itemId", itemIds)`.
   3. For each item type present, one read of the typed table's `customFields` with `.in("id", readableIds)`: `part`, `material`, `tool`, `consumable`. The typed row's `id` is the item's `readableId`, and its `customFields` JSONB is keyed by `customField.id`.
   4. Parse each numeric value with `Number()`. Form data stores custom field values as strings.
5. In the Elements loader, collect the `itemId`s of the project's elements and call `getProjectItemValues` once. Pass the map to `computeVerification` (Task 15).
6. In `ElementTypeBlock`, the Parameter's **Item field** select lists **Unit cost** and the numeric custom fields of the nearest linked item's type. Read them with `getCustomFields`: `customField` rows with `dataTypeId = 4` and `table` = the item type's table.
7. In `IssueMaterialModal`, the element may link an item with an active make method. If it does, list that method's Pull from Inventory and Purchase to Order materials first, under the heading "From the part's bill of materials". Read them with one `getMethodMaterialsByMakeMethod` call (`apps/erp/app/modules/items/items.service.ts:1925`) on the `activeMakeMethods` id.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
psql "$SUPABASE_DB_URL" -c "UPDATE \"projectElement\" SET \"trackedEntityId\" = '<a serial of another item>' WHERE \"id\" = '<element id>';"
# Expected: ERROR: The serial belongs to a different item
```

**Out of scope:** links to a lot. Only serials link.

---

## Task 28: Add Build from part

**Depends on:** 22, 27
**Files:**
- Modify: `apps/erp/app/modules/projects/projects.models.ts` — `planElementsFromSource`
- Modify: `apps/erp/app/modules/projects/projects.server.ts` — `buildElementsFromPart`
- Create: `apps/erp/app/routes/x+/project+/$projectId.elements.build.tsx`
- Create: `apps/erp/app/modules/projects/ui/Elements/BuildFromPartDrawer.tsx`
- Modify: `apps/erp/app/modules/projects/ui/Elements/ElementsHeader.tsx` (the **+ New** menu, Phase 1a Task 33)
- Create: `apps/erp/test/projects-build-from-part.test.ts`
- Copy from (precedent): `getMethodTree` (`apps/erp/app/modules/items/items.service.ts:2001`); the genealogy RPC `get_direct_descendants_of_tracked_entities_strict` (`packages/database/supabase/migrations/20260929152451_traceability-company-scope.sql:4-53`); the Unconsume handling in MES `getTrackedInputs` (`apps/mes/app/services/operations.service.ts:2024-2075`); the id-map insert of `get-method` `jobToJob` (`packages/server-functions/src/get-method/index.ts:4410`)

**Steps:**
1. Add the pure function `planElementsFromSource({ nodes, parentId, rootDepth, depth, includeBought, makeId, startSequence, identifier, defaultStateId })`.
   - `nodes` is a source tree: `{ key, parentKey, itemId, trackedEntityId?, name, replenishment: "Make" | "Buy" }[]`.
   - It keeps nodes down to `depth` levels below the root. Without `includeBought`, it drops `Buy` nodes that have no children.
   - It returns the `projectElement` rows in parent-first order. Each row is a chargeable System element in the default Unstarted state. It gets a new id from `makeId`, a remapped `parentId`, and a readable id from `startSequence`.
2. Add `buildElementsFromPart(db, { companyId, userId, projectId, parentId, source, depth, includeBought })` in `projects.server.ts`. `source` is `{ trackedEntityId }`, `{ itemId }` or `{ templateProjectId }`:
   - **Serial** (the build history). Walk upstream one level at a time, with one RPC call per level for all entities of that level, never per entity:
     1. Call `get_direct_descendants_of_tracked_entities_strict(ids, companyId)`. Despite its name, it returns the entities consumed to make each seed. The rule file `.claude/rules/traceability-model.md` has the direction backwards; Task 31 fixes it.
     2. Load the activity types of the returned `trackedActivityId`s in one query. Keep rows whose activity type is `Consume`. Drop the components that a later `Unconsume` activity of the same assembly gave back, as MES `getTrackedInputs` does.
     3. Load `trackedEntity.itemId` and `readableId` for the kept ids in one query. The RPC returns no `itemId`.
     4. Each kept serial becomes a node with its item and serial. A consumed lot becomes a node with its item only.
     5. Stop at `depth` levels, and at 500 nodes (`MAX_ENTITIES` in `apps/erp/app/modules/inventory/ui/Traceability/constants.ts`).
   - **Item** (the make method). Read the item's `activeMakeMethods` id, then `getMethodTree` once. Keep `Make to Order` children as Make nodes. Keep other materials as Buy nodes. Ignore rows with `isPickDescendant`. `get_method_tree` inner-joins `itemCost`, so an item with no cost row is missing; show the count of skipped lines in the drawer.
   - **Template.** Copy the template's elements under `parentId` with `planProjectCopy`'s element part (Task 22).
   - Lock the project row `FOR UPDATE`, read `nextElementSequence`, then insert the elements in parent-first order in one Kysely transaction, in chunks of 500. Advance `nextElementSequence`.
3. The route action requires `update: "projects"` and calls `buildElementsFromPart`. Its loader returns a preview: the planned rows with no insert.
4. `BuildFromPartDrawer` has these controls:
   - the source: **Serial**, **Item** or **Template**;
   - the serial (`SerialSelect`), item (`Item`) or template picker;
   - depth (1–5, default 2);
   - **Include bought components** (default off);
   - the parent element (default: the element open in the peek, else top level);
   - a preview list of the elements to create, with a count.
5. Write `projects-build-from-part.test.ts` for `planElementsFromSource` with 4 cases:
   1. A make method with 2 Make children and 30 Buy children at depth 2, `includeBought` off, gives 2 elements under the root.
   2. With `includeBought` on, it gives 32.
   3. Depth 1 keeps only the first level.
   4. Every child row's `parentId` is an id that appears earlier in the result.

**Verify:**
```bash
pnpm --filter erp test -- projects-build-from-part
# Expected: 4 passed
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** keeping a built tree in sync with later changes to the make method.

---

## Task 29: Add the element history by part

**Depends on:** 27
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_element-history-by-item.sql`
- Modify: `apps/erp/app/modules/projects/projects.service.ts` — `getElementHistoryByItem`
- Modify: `apps/erp/app/modules/projects/ui/Element/ElementView.tsx` (the Budget section, Phase 1a Task 35)

**Steps:**
1. Run `pnpm db:migrate:new element-history-by-item`. Write a `SECURITY INVOKER` SQL function that calls `assert_company_access(p_company_id)` first:

```sql
CREATE OR REPLACE FUNCTION get_element_history_by_item(p_company_id TEXT, p_item_id TEXT)
RETURNS TABLE ("elementCount" INTEGER, "averageHours" NUMERIC, "averageMaterialCost" NUMERIC, "lastPostingDate" DATE)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM assert_company_access(p_company_id);
  RETURN QUERY
  WITH per_element AS (
    SELECT e."id",
           SUM(CASE WHEN l."costType" = 'Labor' THEN l."quantity" ELSE 0 END) AS hours,
           SUM(CASE WHEN l."costType" = 'Material' THEN l."amount" ELSE 0 END) AS material,
           MAX(l."postingDate") AS last_date
    FROM "projectElement" e
    JOIN "projectLedger" l ON l."projectElementId" = e."id" AND l."companyId" = e."companyId"
    WHERE e."companyId" = p_company_id AND e."itemId" = p_item_id
    GROUP BY e."id"
  )
  SELECT COUNT(*)::INTEGER, AVG(hours), AVG(material), MAX(last_date) FROM per_element;
END $$;
```

2. Run `pnpm db:migrate`, then `pnpm run generate:types`.
3. Add `getElementHistoryByItem(client, companyId, itemId)`.
4. If an element has an `itemId` and `elementCount` > 0, its Budget section shows "Past average: 5.8 h and $420 in materials over 12 elements". Format with `useQuantityFormatter` and `useCurrencyFormatter`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit code 0
```

**Out of scope:** history per serial across customers (field service owns it).

---

## Task 30: Extend the demo datasets

**Depends on:** 5, 14, 15, 27
**Files:**
- Modify: `packages/database/src/datasets/types.ts` — `ProjectSpec` gains `links`, Requirement targets, Test Case verdicts, Parameter fields and `isFinalAsset`
- Modify: `packages/database/src/datasets/tiers/09-accounting.ts`
- Modify: `packages/database/src/datasets/data/{satellite,robotics,precision,motor}/accounting.ts`
- Modify: `packages/database/src/datasets/coverage.ts`

**Steps:**
1. In each dataset's R&D project, add:
   - 2 Parameters (a parent with source Sum and 2 Manual children);
   - 1 Requirement with a `≤` target on the parent Parameter;
   - 1 Test Case that verifies it, with verdict Pass;
   - 3 links: satisfies, verifies and precedes;
   - the constraint: 2 Manual Parameters (supply and load), a Formula Parameter `= <supply> - <load>`, its `feeds` links, and a Requirement with category Design Constraint and target `≥ 0`;
   - one System element linked to a seeded part (`itemId`).
2. Add a Capitalize project to the satellite dataset only, with one final-asset element. Seed no CIP asset: the seed cannot run `ensureCapitalAssets`, so the asset appears when a user releases the project.
3. Insert the links in tier 09 after the elements.
4. Add `projectElementLink` to `COVERAGE_FLOORS` after measuring (the smallest count across the four datasets).
5. Run `pnpm db:check:datasets`.

**Verify:**
```bash
pnpm db:check:datasets
# Expected: all four datasets pass
```

**Out of scope:** seeded views and preferences.

---

## Task 31: Update the rule file, module AGENTS.md, docs and spec

**Depends on:** 1–30
**Files:**
- Modify: `.claude/rules/projects-system.md`
- Modify: `apps/erp/app/modules/projects/AGENTS.md`
- Modify: `.claude/rules/traceability-model.md` — the lineage direction
- Modify: `.claude/rules/fixed-asset-lifecycle.md` — the project CIP sources, `postCapitalization`, the void guard change and the remaining-life Straight Line
- Modify: `docs/content/docs/reference/projects.mdx`
- Modify: `.ai/specs/2026-10-03-projects.md` — the changelog, and the decisions this plan made

**Steps:**
1. Document only committed code. Ground every claim in a file.
2. In the spec, record these decisions:
   1. **CIP flag:** `CONSTRUCTION_IN_PROGRESS_ENABLED` stays false; project screens read CIP classes directly.
   2. **Charge lines:** charge numbers on charge lines are read-only until the editable spend spec lands.
   3. **Timeline:** a new component, not the scheduling Gantt.
   4. **Saved views:** the project's own view tables, because `tableView` has no options column.
   5. **Void guards:** they now allow voiding late-cost documents.
   6. **Formulas:** a closed grammar parsed in TypeScript; no QuickJS sandbox, because the grammar runs no code.
   7. **Item values:** read from the typed item tables' `customFields`, because `item` has no `customFields` column.
3. In `.claude/rules/traceability-model.md`, correct the lineage direction: `get_direct_descendants_of_tracked_entities_strict` returns the inputs consumed to make an entity (upstream), and `get_direct_ancestors_…` returns where it was used (downstream).
4. Run the STE-80 review pass on every `.ai/` file you changed.

**Verify:**
```bash
cd docs && pnpm typecheck
# Expected: exit code 0
pnpm --filter @carbon/checks license-headers
# Expected: no files changed
```

**Out of scope:** the changelog entry.

---

## Task 32: Verify in the browser

**Depends on:** 1–31
**Files:**
- Create: `.ai/playbooks/projects-phase-1b.md` (written by `/test`)

**Steps:**
1. Run `/test` on a satellite dataset company with accounting on.
2. Cover these spec acceptance criteria:
   1. **Workspace and verification:**
      - `SNS-4` passes at 115 g and fails at 125 g.
      - A failing Test Case keeps it failing.
      - A target change marks the verifying link suspect until reviewed.
   2. **Allocation:** a 30 % child under 2,000 kg shows "≤ 600 kg (30.0 % of 2,000 kg)" and fails at 610 kg.
   3. **Capital project:**
      - Release creates the assets.
      - Time, a Service PO line and a job reach CIP.
      - Expense-override time does not reach CIP.
      - Place in service capitalizes and completes the element.
      - A later invoice adds to the Active asset.
      - The next depreciation run spreads the addition.
   4. **Depreciation basis:** an existing Straight Line asset's next run amount is unchanged.
   5. **Layouts:**
      - Tree shows parent and trace links, and adds a link by drag.
      - Timeline shows bars and `precedes` arrows.
      - Reader renders and exports a PDF.
   6. **Views:** a saved shared view restores its layout and filters for another user.
   7. **Template:** **Copy from** makes a Draft project with the same tree and links.
   8. **Create Job / Create PO line** from plan lines, each with the charge number.
   9. **Reimbursement charge number:** the posted journal carries one Project tag.
   10. **Burn chart:** the burn chart shows actual and ideal lines.
   11. **Constraint:** a Formula Parameter `= SNS-20 - SNS-21` shows 8 W, and its Requirement `≥ 0 W` passes. At a load of 55 W it shows −5 W and fails at once. A circular formula shows an error.
   12. **Contingency:** 115 g with 10 % checks as 126.5 g and fails `≤ 120 g`.
   13. **Item parameter:** a Parameter with source Item shows the linked part's numeric custom field.
   14. **Build from part:** from an item with 2 Make to Order sub-assemblies, depth 2 creates 2 System elements linked to them. From a serial Carbon built, the elements link the consumed serials.
   15. **Part history:** an element linked to an item that other elements charged shows the past average.
3. Save the playbook to `.ai/playbooks/projects-phase-1b.md`.

**Verify:**
```bash
ls .ai/playbooks/projects-phase-1b.md
# Expected: the file exists, and the /test run reports every step passed
```

**Out of scope:** Phase 1c (baselines and change requests).

## Execution notes

- Prerequisite check: the Phase 1a artifacts this plan names exist. They are the `project` and `projectElement` tables (with `itemId` and the `projectElement_project_key` UNIQUE on `id, projectId, companyId`), `fixedAssetCipCost`, `.claude/rules/projects-system.md` and `packages/server-functions/src/lib/project-posting.ts`. Every Phase 1a task is committed except Task 47 (browser verification, deferred by the overnight run).
- Tasks 1–4: each migration was applied with `pnpm db:migrate` before its commit, and its regenerated types were committed with it, as in Phase 1a. The pre-commit `check:manifest` gate refuses a migration commit with a stale digest.
- Tasks 1–4: `pnpm run check:workflow-catalog` fails before this plan. Phase 1a added `job.projectId`, `job.projectElementId` and `job.consumeToProject`, and the catalog has no labels for them. This plan leaves that failure alone.
- Task 2: the CHECK name is `fixedAssetCipCost_sourceType_check`, as the plan says. `fixedAsset`, `fixedAssetClass` and `trackedEntity` have a single-column primary key and no `(id, companyId)` UNIQUE, so their new FKs stay single-column, as the plan writes them. The FK indexes are plain (not partial), as in Phase 1a.
- Task 2: `turbo run typecheck --filter=@carbon/jobs` fails on 2 errors in `server-functions/src/post-timesheet/index.ts` (lines 158 and 161: the `inOrder` results infer as `any[][]`). The same 2 errors show with the types from before this migration, so this plan did not cause them. `@carbon/server-functions`, `erp` and `mes` typecheck green.
