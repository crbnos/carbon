---
paths:
  - "apps/erp/app/modules/quality/**"
  - "apps/erp/app/routes/x+/issue+/**"
  - "packages/database/supabase/migrations/*ncr*.sql"
---

# Issue / Non-Conformance Module

Carbon's quality module tracks non-conformances (NCRs), surfaced in the UI as
"Issues". Code lives in `apps/erp/app/modules/quality/` (NOT a separate `issue`
module); routes live under `apps/erp/app/routes/x+/issue+/`. Schema is grounded
in the migrations — **newest wins**; core tables created in
`20250327140050_ncr.sql`.

## Code (real paths)

- `quality.service.ts` — issue/task/association/reviewer service functions.
- `quality.models.ts` — zod validators + status/enum const arrays.
- `quality.server.ts` — server helpers (e.g. `closeIssue`, task creation glue).
- `ui/Issue/` — `IssueHeader`, `IssueContent`, `IssueForm`, `IssueProperties`,
  `IssueStatus`, `DispositionStatus`, `IssueTask`, `ActionTasksList`,
  `ReviewersList`, `AssociatedItemsList`, `IssueAssociations`, `IssuesTable`
  (see `ui/Issue/index.ts`). Plus `ui/IssueTypes/`, `ui/IssueWorkflows/`,
  `ui/RequiredActions/`, `ui/Actions/`.
- Task creation edge function: `packages/database/supabase/functions/create/index.ts`,
  case `"nonConformanceTasks"`.

## Status enums (verified in `quality.models.ts` + migrations)

- **Issue status** (`nonConformanceStatus`): `Registered` → `In Progress` → `Closed`.
  DB column default is `'Registered'`. `isIssueLocked(status)` ⇒ `status === "Closed"`
  (blocks edits to issue + task assignments).
- **Task status** (`nonConformanceTaskStatus`): `Pending`, `In Progress`,
  `Completed`, `Skipped`. Tasks start `Pending`; they do **not** auto-start.
- **Source** (`nonConformanceSource`): `Internal`, `External`.
- **Priority** (`nonConformancePriority`): `Low`, `Medium`, `High`, `Critical`.
- **Approval requirement** (`nonConformanceApproval` / `nonConformanceApprovalRequirement`):
  only `MRB` (Material Review Board).
- **Disposition**: DB enum `disposition` has **11** values (`Conditional Acceptance`,
  `Deviation Accepted`, `Hold`, `No Action Required`, `Pending`, `Quarantine`,
  `Repair`, `Return to Supplier`, `Rework`, `Scrap`, `Use As Is`); on
  `nonConformanceItem.disposition` (default `'Pending'`), added `20251114222648`.
  `DispositionStatus.tsx` renders all 11. **Gotcha:** the `disposition` const array
  in `quality.models.ts` currently has most values **commented out** (only `Pending`,
  `Return to Supplier`, `Rework`, `Scrap`, `Use As Is` active) — the picker is a
  deliberate subset of the DB enum.

## Workflow (header buttons → routes)

`IssueHeader.tsx` (all gated by `permissions.can("update","quality")`):
- **Start** (when `Registered`) → POST `path.to.issueStatus(id)` `{status:"In Progress"}`.
- **Complete** (when `In Progress`) → `path.to.closeIssue(id)` (sets `Closed`, clears
  assignee, sets `closeDate`).
- **Reopen** (when `In Progress`/`Closed`, not locked) → `issueStatus` `{status:"Registered"}`.
- **Delete Issue** → `path.to.deleteIssue(id)`.

Issue **auto-starts** to `In Progress` when a user first types in a task note while
the issue is still `Registered` (`IssueTask.tsx`, one-shot).

Tasks (`IssueTask.tsx` `statusActions`): **Start** (`Pending`→`In Progress`),
**Complete** (`In Progress`→`Completed`), **Reopen** (`Completed`/`Skipped`→`Pending`).
Task status writes go to `path.to.issueTaskStatus`; `updateIssueTaskStatus` sets
`completedDate` on `Completed`.

## Required actions & system action types

Issues carry `requiredActionIds TEXT[]` (IDs into `nonConformanceRequiredAction`).
The create edge function inserts one `nonConformanceActionTask` per id (1-indexed
`sortOrder`). `nonConformanceRequiredAction.systemType` (enum
`nonConformanceSystemActionType`, added `20260313000001`):
`Containment`, `Corrective`, `Preventive`, `Verification`, `Communication`. System
rows are protected by trigger `protect_system_required_actions_trigger` (can't delete
or change `systemType`); unique per `(companyId, systemType)`. Custom actions have
`systemType IS NULL`.

## Approvals / MRB / reviewers

`approvalRequirements nonConformanceApproval[]` → the edge function inserts a
`nonConformanceApprovalTask` per requirement. When `MRB` is newly required it
seeds two `nonConformanceReviewer` rows (`title: "Engineering"`, `"Quality"`);
removing MRB deletes the reviewers; existing reviewers are left untouched.
Reviewers managed in `ReviewersList.tsx` (`nonConformanceReviewerValidator` = just
`title`); `insertIssueReviewer`, `getIssueReviewers`.

## Routes & URL structure

- List: `/x/quality/issues` (`x+/quality+/issues.tsx`, `IssuesTable`).
- Detail: `/x/issue/{id}` → `_index` redirects to `…/details`. There are **no**
  separate `/investigations`, `/actions`, or `/review` view tabs — action tasks and
  reviewers render **inline** in `$id.details.tsx`. (`$id.review.tsx` and
  `$id.status.tsx`/`$id.close.tsx` are **POST-only**.)
- Other actions under `x+/issue+/`: `new.tsx`, `task.$id.status.tsx`,
  `task.supplier.tsx` (only `nonConformanceActionTask`), `action.$id.due-date.tsx`,
  `action.$id.processes.tsx` (→ `nonConformanceActionProcess`),
  `action-tasks.order.tsx` (sortOrder reorder), `$id.association.new.tsx`,
  `$id.association.delete.$type.$associationId.tsx`, and `item+/`
  (`update`, `assign-entities`, `split`).

## Core tables (current schema)

- `nonConformance` — main entity. `id` (`id('nc')`), `nonConformanceId` (readable),
  `name`, `description`, `source`, `status` (default `Registered`), `priority`,
  `requiredActionIds TEXT[]`, `approvalRequirements nonConformanceApproval[]`,
  `nonConformanceWorkflowId`, `nonConformanceTypeId`, `content JSON`, `locationId`,
  `openDate`/`dueDate`/`closeDate`, `quantity`, `assignee`, audit. (`itemId` was
  dropped `20250905122922` → moved to junction.)
- `nonConformanceType`, `nonConformanceWorkflow`, `nonConformanceRequiredAction`.
- Tasks: `nonConformanceActionTask` (`actionTypeId`→requiredAction, `sortOrder`,
  `status`, `supplierId` (`20251114222648`), `dueDate`), `nonConformanceApprovalTask`
  (`approvalType`), `nonConformanceReviewer` (`title`, `status`).
- `nonConformanceActionProcess` — action task ↔ process.
- Multi-item: `nonConformanceItem` (junction, `20250905122922`; `disposition`),
  `nonConformanceItemTrackedEntity` (`20260421130000`).
- Associations (10 types, see `nonConformanceAssociationType`):
  `nonConformanceCustomer`, `nonConformanceSupplier` (`externalLinkId` →
  `externalLink`), `nonConformanceJobOperation`, `nonConformancePurchaseOrderLine`,
  `nonConformanceSalesOrderLine`, `nonConformanceShipmentLine`,
  `nonConformanceReceiptLine`, `nonConformanceTrackedEntity`,
  `nonConformanceInboundInspection` (`20260421091238`).

## `issues` view

`SECURITY_INVOKER=true`; newest def `20260317033634_issues-fix.sql`. Selects
`nonConformance.*` plus `items` (TEXT[] from `nonConformanceItem`) and a computed
`containmentStatus`: `Contained` (a Containment-`systemType` action task is
`In Progress`/`Completed`), else `Uncontained` (a Containment task exists), else
`N/A`. `getIssues` reads this view. (`companySettings.qualityIssueTarget`, default
20, added alongside.)

## Gotchas

- **Investigations were removed.** Migration `20251120214020_action-investigation-merge.sql`
  **dropped** `nonConformanceInvestigationTask` and `nonConformanceInvestigationType`,
  merged `investigationTypeIds` into `requiredActionIds`, and dropped the
  `nonConformanceInvestigation`/`nonConformanceAction` enums. Investigation types are
  now just `nonConformanceRequiredAction` rows; their tasks are `nonConformanceActionTask`
  rows. **Dead code:** `IssueTask.tsx` `getTable()` and `api+/assign.ts` still have an
  `"investigation"` branch returning `"nonConformanceInvestigationTask"` — that table no
  longer exists; treat the `type: "investigation"` UI path as vestigial.
- The module is `quality`, not `issue`; permission key is `quality`. Routes are split
  (`x+/quality+/` for list/types/workflows, `x+/issue+/` for the detail + actions).
- Slack NC notifications are config on the `integration` row (`20250810203046`):
  `nonconformance_channel_id`, `nonconformance_notifications_enabled` — no extra tables.
- Filename `20251114222648_supplier_id.sql` is non-conformance work (supplier links +
  disposition enum), not a generic "supplier" change.
