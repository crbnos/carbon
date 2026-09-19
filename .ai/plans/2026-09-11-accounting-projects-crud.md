# Accounting Projects CRUD — implementation plan

**Spec:** `.ai/specs/2026-09-11-accounting-projects-crud.md`
**Research:** `.ai/research/accounting-projects.md`
**Branch:** `feat/feat-ramp`

## Progress

- [x] Task 1: Add the company-scoped Project table and regenerate schema artifacts
- [x] Task 2: Add and test the Project validator
- [x] Task 3: Add company-scoped Project services and inferred type
- [ ] Task 4: Add flat Projects CRUD routes/UI, navigation, translations, and browser verification

## Dependencies

Task 2 is independent of Task 1. Task 3 needs Tasks 1–2 so generated database types and the validator exist. Task 4 needs Task 3. Tasks execute serially because Tasks 2–4 modify shared Accounting module files and each task is committed through the verification gate.

---

## Task 1: Add the company-scoped Project table and regenerate schema artifacts

**Depends on:** none
**Files:**
- Create via `pnpm db:migrate:new accounting-projects`: `packages/database/supabase/migrations/20260911170920_accounting-projects.sql`
- Modify (generated): `packages/database/src/types.ts`
- Modify (generated): `packages/database/supabase/functions/lib/types.ts`
- Modify (generated): `packages/database/src/swagger-docs-schema.ts`
- Copy from (precedent): `packages/database/supabase/migrations/20260609143732_document-template.sql`

**Steps:**
1. Run `pnpm db:migrate:new accounting-projects`; do not choose or backdate the timestamp manually, and confirm its timestamp sorts after `20260911150058`.
2. Put this exact SQL in the generated migration:

```sql
CREATE TABLE "project" (
  "id" TEXT NOT NULL DEFAULT id('prj'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  UNIQUE ("companyId", "name")
);

CREATE INDEX "project_companyId_idx" ON "project" ("companyId");
CREATE INDEX "project_createdBy_idx" ON "project" ("createdBy");
CREATE INDEX "project_updatedBy_idx" ON "project" ("updatedBy");

ALTER TABLE "public"."project" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."project"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."project"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."project"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."project"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);
```

3. Run `pnpm db:migrate`. Do not rebuild/reset the database. Confirm it applies the new migration and regenerates database types/schema.
4. Confirm the three generated schema artifacts contain the `project` Row/Insert/Update shape and that no unrelated migration file was rewritten.

**Verify:**

```bash
pnpm db:check:datasets
pnpm db:check:backups
pnpm --filter @carbon/database typecheck
# Expected: both compatibility checks exit 0 without writing business data; @carbon/database typecheck exits 0.
```

**Out of scope:** No `dimensionEntityType`, dimension seed/backfill, journal/document-line foreign key, Ramp code, audit configuration, existing table mutation, or database rebuild.

## Task 2: Add and test the Project validator

**Depends on:** none
**Files:**
- Create: `apps/erp/app/modules/accounting/accounting.projects.test.ts`
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts`
- Copy from (precedent): `apps/erp/app/modules/inventory/inventory.models.test.ts`

**Steps:**
1. Following red→green discipline, add a test that dynamically reads `projectValidator` from the Accounting models namespace, first asserts it is defined, then verifies: a padded name/description parses to trimmed strings; an empty/whitespace name fails; an omitted or empty description parses as `undefined`.
2. Run the focused test before adding production code. It must fail on the `projectValidator`-is-defined assertion, not from an import, syntax, or collection error, and must collect a nonzero test count.
3. Add `projectValidator` next to `costCenterValidator` in `accounting.models.ts` with `id: zfd.text(z.string().optional())`, trimmed required `name`, and `description: zfd.text(z.string().trim().optional())`.
4. Run the focused test again and confirm all Project validator behaviors pass.

**Verify:**

```bash
pnpm --filter erp exec vitest run app/modules/accounting/accounting.projects.test.ts
pnpm exec turbo run typecheck --filter=erp
# Expected: the focused test collects and passes all Project tests; scoped ERP typecheck exits 0.
```

**Out of scope:** No owner, customer, date, code, hierarchy, status workflow, active form input, custom fields, selector, or route behavior.

## Task 3: Add company-scoped Project services and inferred type

**Depends on:** Tasks 1–2
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.ee.service.ts`
- Modify: `apps/erp/app/modules/accounting/types.ts`
- Modify (generated): `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`
- Copy from (precedent): `apps/erp/app/modules/accounting/accounting.ee.service.ts` — `getPaymentTerms`, `upsertPaymentTerm`, and `deletePaymentTerm`

**Steps:**
1. Import `projectValidator` as a type dependency in the existing Accounting service import group.
2. Add `getProjects(client, companyId, args)` selecting `project` rows with count, explicit `.eq("companyId", companyId)`, `.eq("active", true)`, optional name/description search, generic filters, and default ascending name order.
3. Add `getProject(client, companyId, projectId)` with both id and company predicates and `.single()`.
4. Add `upsertProject(client, project)` with a discriminated create/update union. Create includes `companyId`, `createdBy`, `active: true`; update includes `id`, `companyId`, and `updatedBy`, uses `sanitize`, sets `updatedAt: datetime.timestamp()`, and filters by both id and companyId. Both return selected id via `.single()`.
5. Add `deleteProject(client, companyId, projectId, updatedBy)` as an update to `{ active: false, updatedBy, updatedAt: datetime.timestamp() }`, filtered by id and companyId, returning selected id via `.single()`.
6. Add `getProjects` to the service-type imports in `types.ts` and export `Project` inferred from its row data.
7. Run `pnpm generate:mcp` and keep only the committed digest change. The generated `tool-metadata.json` remains gitignored.

**Verify:**

```bash
pnpm run generate:mcp
pnpm exec turbo run typecheck --filter=erp
pnpm --dir apps/erp exec vitest run app/modules/accounting
# Expected: MCP generation includes Project service tools without fallback errors introduced by this change; scoped ERP typecheck exits 0; Accounting tests pass with a nonzero test count.
```

**Out of scope:** No unscoped query, Kysely/database client construction, physical DELETE, React Query cache, API picker endpoint, dimension value resolver, or provider integration.

## Task 4: Add flat Projects CRUD routes/UI, navigation, translations, and browser verification

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Projects/ProjectForm.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Projects/ProjectsTable.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Projects/index.ts`
- Create: `apps/erp/app/routes/x+/accounting+/projects.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/projects.new.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/projects.$projectId.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/projects.delete.$projectId.tsx`
- Modify: `apps/erp/app/utils/path.ts`
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx`
- Modify (generated by `/translate`): `packages/locale/locales/{de,en,es,fr,hi,it,ja,ko,pl,pt,ru,tr,zh}/erp.po`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/payment-terms.tsx`
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/PaymentTerms/PaymentTermsTable.tsx`
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/PaymentTerms/PaymentTermForm.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/payment-terms.new.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/payment-terms.$paymentTermId.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/accounting+/payment-terms.delete.$paymentTermId.tsx`

**Steps:**
1. Add `path.to.projects`, `path.to.project(id)`, `path.to.newProject`, and `path.to.deleteProject(id)` beside the Cost Center helpers. Use only `path.to.*` in links, actions, redirects, and cancel handlers.
2. Add Projects to the Accounting Configure navigation immediately after Cost Centers, using an existing `react-icons/lu` icon already available to the module.
3. Build `ProjectsTable` with Carbon's shared `Table`, Name and Description columns, name hyperlink preserving URL params, permission-gated New Project primary action, and permission-gated Edit/Delete row menu items. It is flat: no tree tabs, depth, expanders, parent, or add-child action.
4. Build `ProjectForm` as the existing drawer/modal pattern with raw `projectValidator`, hidden id/type fields, Project Name, optional Description using existing form components, permission-aware Submit, and translated modal success/error text.
5. Build the list route loader using `accounting_view`, generic URL filters, and `getProjects`; return/throw a flashed error rather than silently treating an errored query as an empty list. Render `ProjectsTable` plus nested `<Outlet>`.
6. Build create, edit, and delete nested routes. Actions call `assertIsPost` first, use `accounting_create`, `accounting_update`, and `accounting_delete` respectively, validate with `validator(projectValidator)`, pass `companyId` into every read/write, and redirect with translated-compatible flash copy. Delete passes `userId` into `deleteProject` for audit attribution.
7. Run the normal code gates, then use `/translate` so all 13 ERP catalogs contain no missing Project strings.
8. Browser-test the running ERP with `/test`: navigate to Projects; create `Apollo Expansion` with description `Customer expansion program`; verify it appears; edit its description to `Customer expansion program — phase 2`; verify the updated row; delete it; verify it disappears from the active table. Cache the passing flow at `.ai/playbooks/accounting-projects-crud.md`. Also verify the page has no Tree View control and Cost Centers still loads.

**Verify:**

```bash
pnpm exec biome check --write --no-errors-on-unmatched apps/erp/app/modules/accounting/accounting.models.ts apps/erp/app/modules/accounting/accounting.ee.service.ts apps/erp/app/modules/accounting/types.ts apps/erp/app/modules/accounting/accounting.projects.test.ts apps/erp/app/modules/accounting/ui/Projects apps/erp/app/routes/x+/accounting+/projects.tsx apps/erp/app/routes/x+/accounting+/projects.new.tsx 'apps/erp/app/routes/x+/accounting+/projects.$projectId.tsx' 'apps/erp/app/routes/x+/accounting+/projects.delete.$projectId.tsx' apps/erp/app/utils/path.ts apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx
pnpm exec turbo run typecheck --filter=erp
pnpm --dir apps/erp exec vitest run app/modules/accounting
# Then execute `/test Accounting Projects create, edit, and delete`.
# Expected: Biome and scoped typecheck exit 0; Accounting tests pass; browser flow passes create/edit/delete, Projects is flat, and Cost Centers still renders.
```

**Out of scope:** No Project selector/API picker, `dimensionEntityType` change, dimension seed/backfill, journal/source-line Project assignment, Cost Center rename/migration, Ramp field/options/coding changes, docs-site content, or PR creation.
