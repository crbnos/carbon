---
id: "1009"
kind: feature
risk: med
issue: 1009
title: "Bulk employee invite — add multiple users from a single screen"
acceptance:
  - "A 'Invite Multiple' button is visible on the employee accounts screen alongside the existing 'New Account' button"
  - "Clicking 'Invite Multiple' opens a bulk invite screen/modal with a multi-row form"
  - "Each row collects: email, first name, last name, employee type (select), location (select)"
  - "Users can dynamically add rows (+ button) and remove individual rows (x per row)"
  - "A single 'Invite All' submit action sends all invitations"
  - "Per-row validation blocks submission: missing required fields and invalid emails show inline errors"
  - "Duplicate email addresses across rows are detected and flagged before/during submission"
  - "After submission, per-invitation feedback is shown (success / already-exists / error)"
  - "Existing single-invite flow (employees.new route and CreateEmployeeModal) is unchanged"
  - "TypeScript compiles clean and biome lint passes"
---

# Bulk employee invite — add multiple users from a single screen

## Issue
https://github.com/crbnos/carbon/issues/1009

## Task Brief
Full details at: /home/openclaw/.openclaw/workspace/tasks/1009.md

## Relevant Paths
- **Existing single-invite route:** `apps/erp/app/routes/x+/users+/employees.new.tsx` — model after this
- **Employees table (add button here):** `apps/erp/app/modules/users/ui/Employees/EmployeesTable.tsx` (line ~381, near the `<New>` button)
- **Validator to extend:** `createEmployeeValidator` in `apps/erp/app/modules/users/users.models.ts`
- **Server fn:** `createEmployeeAccount` in `apps/erp/app/modules/users/users.server.ts`
- **Component exports:** `apps/erp/app/modules/users/ui/Employees/index.ts`
- **Path constants:** `apps/erp/app/utils/path.ts` (add `bulkInviteEmployees`)

## Files to Create
1. `apps/erp/app/routes/x+/users+/employees.bulk-invite.tsx` — new route
2. `apps/erp/app/modules/users/ui/Employees/BulkInviteEmployeesModal.tsx` — new component

## Files to Edit
3. `apps/erp/app/modules/users/users.models.ts` — add `bulkCreateEmployeeValidator`
4. `apps/erp/app/modules/users/ui/Employees/EmployeesTable.tsx` — add "Invite Multiple" button
5. `apps/erp/app/modules/users/ui/Employees/index.ts` — export new component
6. `apps/erp/app/utils/path.ts` — add `bulkInviteEmployees` path

## Implementation Notes
- The action in employees.bulk-invite.tsx should iterate rows, call `createEmployeeAccount` + sendEmail per entry (same pattern as employees.new.tsx), collect results, and return per-row feedback (not a redirect)
- For the form, use react-hook-form with useFieldArray for dynamic rows (follow existing patterns in the codebase)
- Per-row duplicate detection: check within the submitted rows themselves, not just against existing DB records
- The route is a modal route (like employees.new) — renders as overlay on top of employees list
- Follow i18n patterns (lingui) used elsewhere in the module
