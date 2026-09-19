# Accounting Projects CRUD

> Status: in-progress
> Author: Codex
> Date: 2026-09-11
> Research: [.ai/research/accounting-projects.md](../research/accounting-projects.md)

## TLDR

Add Projects as a flat Accounting master-data list with create, read, update, and soft-delete UI. A Project has a stable generated id, company scope, unique name, optional description, active state, and standard audit fields. This is the first slice of a larger feature: a later slice will make Project a journal-line dimension entity, and a final slice will converge Projects to Ramp as a distinct custom accounting field. Cost Centers and Projects remain separate concepts and separate external fields.

## Problem Statement

Carbon currently exposes Cost Centers as hierarchical accounting masters and syncs them to Ramp as one custom accounting field. Some customers also need a separate Project classifier. Reusing or renaming Cost Centers as “Projects” conflates organizational responsibility with project spend, prevents a transaction from carrying both values, and carries an unnecessary parent/child tree into a flat coding list.

Before a Project can be selected on transactions or synchronized to Ramp, users need a company-scoped place to maintain the Project list. That first slice must establish stable identities and lifecycle semantics that remain safe once journal history and external mappings refer to each row.

## Proposed Solution

Create a `project` table and a flat Projects page under Accounting → Configure. The page follows the existing Payment Terms table/drawer pattern: searchable/paginated table, permission-gated New action, edit/delete row actions, and nested drawer routes. The form contains Project Name and optional Description. Delete is implemented as `active = false`; active lists exclude inactive Projects while direct historical reads remain possible.

This slice deliberately does not add a Project selector, dimension enum/value resolution, document-line `projectId` fields, journal posting behavior, or Ramp API calls. It establishes the master record those later slices will reference.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-tenancy | Company-scoped `project` with composite primary key `("id", "companyId")` | Projects classify one company's transactions; this matches Cost Centers and prevents cross-tenant references. |
| Primary identity | Immutable `id('prj')` | Ramp and journal dimensions need a stable identifier independent of mutable display text. |
| User-facing identity | Required company-unique `name`; no separate code in this slice | The requested feature is an accounting coding list, not project management. The immutable id satisfies integration identity; a required user-managed code would add workflow the request did not require. |
| Additional fields | Optional `description`; no owner, customer, dates, task status, budget, or hierarchy | SAP/NetSuite show those as project-management concerns. Cost Center owner is specifically coupled to PO approvals and is not a general Project requirement. |
| Lifecycle | `active BOOLEAN`; Delete soft-deactivates | Historical dimension assignments and Ramp mappings must retain a resolvable master. NetSuite and Ramp both preserve inactive values while hiding them from new coding. |
| Name reuse | Unique `(companyId, name)` across active and inactive rows | Prevents ambiguous historical labels and accidental external duplication; restoring/reusing a name must be an explicit future workflow. |
| Permissions | Existing `accounting_view/create/update/delete` scopes | Projects belong inside Accounting; no new permission family is needed. |
| Service shape | Supabase client first; raw `{ data, error }`; all reads and writes explicitly company-scoped | Matches module/service conventions and defense-in-depth tenant isolation. |
| RLS | Standard SELECT plus Accounting INSERT/UPDATE/DELETE policies | Matches current database conventions and the existing Accounting boundary. |
| Forms | `ValidatedForm` with raw zod schema; route actions validate through `validator(schema)` | Matches the closest `@carbon/form` and Accounting precedents. |
| UI precedent | Payment Terms table plus drawer CRUD, with Cost Center copy used only for naming/context | Payment Terms is the closest flat Accounting CRUD surface; Cost Center tree and approval-owner coupling are intentionally excluded. |
| Custom fields | Omitted from this slice | Adding a custom-field registry entry would broaden the first slice without helping dimension or Ramp coding. |
| Backward compatibility | Additive table, service exports, routes, and nav item only | The database is additive-only and route paths are stable; no existing contract is renamed or removed. |
| Prior Ramp “Project” naming | Supersede the prior customer-specific practice of naming the CostCenter field “Project” | The new model requires independent Cost Center and Project fields so a transaction can carry both. Existing cost-center data and sync remain unchanged. |

## Data Model Changes

Create one additive table in a newly generated migration:

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

No existing table, enum, or foreign key changes in this slice. Generated database types and derived API/MCP artifacts are refreshed after migration.

## API / Service Changes

Add to the Accounting module:

- `projectValidator`: optional id, trimmed required name, optional trimmed description.
- `getProjects(client, companyId, filters)`: paginated/searchable active list ordered by name.
- `getProject(client, companyId, projectId)`: company-scoped single read, including inactive rows for direct/history-safe resolution.
- `upsertProject(client, data)`: create or update with company-scoped update predicate and audit fields.
- `deleteProject(client, companyId, projectId)`: soft-deactivate with `active = false`, company scope, updater identity, and update timestamp.
- `Project` inferred type in `types.ts` and existing wildcard barrel export.

Add stable paths for list, new, detail/edit, and delete routes. All loaders/actions use `requirePermissions` with the matching Accounting action and handle service errors via the flash system. New/edit forms use drawers nested under the list route.

## UI Changes

- Add Projects under Accounting → Configure, adjacent to Cost Centers and Dimensions.
- Add a flat table titled Projects with Name and Description columns.
- Add permission-aware New Project, Edit Project, and Delete Project actions.
- Add a drawer form with Project Name and optional Description fields.
- Add a confirmation drawer for soft deletion.
- Use Lingui macros for all new user-facing strings.
- Do not add tree/list tabs, parent selection, owner selection, or a Project form selector in this slice.

## Follow-on Contracts

These are sequenced follow-ups, not implementation scope or acceptance criteria for this first slice:

1. **Dimension slice** — add `Project` to `dimensionEntityType` and the app validator in one migration/code task, then seed/backfill a group-level Project dimension in a later migration because PostgreSQL cannot consume a newly added enum value in the same transaction. Add Project option loading/name resolution to the existing DimensionSelector and provider dimension-label resolver. Only active Projects appear for new assignment; historical ids continue to resolve.
2. **Transaction propagation slice** — add tenant-safe `projectId` source references wherever Ramp-coded transaction lines must preserve the selection before posting, including card transactions and the applicable bill/reimbursement line paths. Journal posting writes a Project `journalLineDimension` row; no path may silently drop a selected Project.
3. **Ramp slice** — converge a second, splittable `SINGLE_CHOICE` field with its own constant external id. Use `project.id` as the option external id, diff before create, PATCH renames, HIDE inactive projects, restore visibility on reactivation, and decode incoming selections by `category_info.external_id`, never semantic `type` or display name. Keep Cost Center convergence unchanged.

## Acceptance Criteria

- [ ] An employee with `accounting_view` can open `/x/accounting/projects` and see a flat, alphabetically sorted, searchable Projects table with no tree controls.
- [ ] An employee with `accounting_create` can create a Project with a trimmed non-empty name and optional description; the Project appears in the list after redirect.
- [ ] Duplicate Project names in the same company fail without creating a second row; the same name may exist in a different company.
- [ ] An employee with `accounting_update` can edit a Project name or description, and all single-record/update queries are scoped by both project id and company id.
- [ ] An employee with `accounting_delete` can confirm Delete; the row becomes inactive and disappears from the active list without being physically removed.
- [ ] Users without the corresponding create/update/delete Accounting permissions cannot invoke those routes or UI actions.
- [ ] Project ids use `prj_`-style generated identities, the table has the standard audit fields/composite tenant key/indexes, and all four RLS policies use current helpers.
- [ ] Existing Cost Center CRUD, dimension behavior, and Ramp cost-center sync are unchanged.
- [ ] The migration applies, generated types/artifacts are current, Accounting tests and scoped ERP typecheck pass, and the create → edit → delete browser flow passes against the running app.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| “Project” conflicts with project-management expectations | Medium | Keep this spec explicit: it is an accounting dimension master only; omit tasks, budgets, schedules, and customers. |
| Soft-deleted names cannot be reused | Low | Preserve unambiguous historical identity now; add an explicit restore workflow later if users need it. |
| Existing Ramp setup labels Cost Centers as “Project” | Medium | Do not mutate that field in this slice; the later Ramp slice creates a distinct field and documents the migration/labeling behavior. |
| Generic polymorphic dimension values lack a database FK | Medium | Never hard-delete Projects; future selectors exclude inactive rows while history resolvers include them. |
| Large branch contains unrelated Ramp work | Medium | Stage and commit only the exact Projects files; preserve the existing dirty card-transaction route and unrelated run records. |

## Open Questions

- [x] **Should Projects have a separate user-managed code in the first slice?** — **Autonomous:** No. Carbon/Ramp can sync safely with the immutable generated id, and the request is for a coding dimension rather than project management. A code can be added additively if a later customer workflow needs it.
- [x] **Should Delete physically remove a Project?** — **Autonomous:** No. Follow NetSuite/Ramp precedent and preserve future historical dimension/Ramp references by setting `active = false`.
- [x] **Should Projects inherit Cost Center owner and hierarchy fields?** — **Autonomous:** No. The user explicitly rejected a tree; owner is coupled to Cost Center purchase approvals and lacks Project-domain justification.
- [x] **Should the first slice register Project custom fields?** — **Autonomous:** No. Name and description satisfy the requested master-data UI; custom-field registration is orthogonal scope.
- [x] **Does this run implement dimension selection and Ramp synchronization?** — **Autonomous:** No. The user's sequence makes Projects CRUD the first implementation slice; the later contracts are documented above so this slice remains compatible.

## Changelog

- 2026-09-11: Created for the autonomous first slice. Resolved the five product questions from Carbon precedent and competitor consensus. Recorded the follow-on dimension, transaction-propagation, and Ramp contracts, and explicitly superseded the prior practice of representing a customer “Project” by renaming Cost Centers.
