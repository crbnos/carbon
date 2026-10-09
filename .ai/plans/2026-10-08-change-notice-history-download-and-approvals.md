# Change Notice History Download and Approval Rules — implementation plan

**Spec / source:** `.ai/specs/2026-10-08-change-notice-history-download-and-approvals.md`
**Branch:** `feat/download-changenotice-and-approval-rule`

> Note: the 2026-10-09 review refactor replaced the per-feature helpers named in Tasks 7–10 (`changeNoticeApprovalValidator`, `isChangeNoticeAwaitingApproval`, `getChangeNoticeApprovalContext`, `ChangeNoticeApprovalModal`) with the shared `@carbon/ee/approvals/document.server` helpers, `approvalDecisionValidator` and the `ApprovalDecision` modal. The spec is the current description.

## Progress
- [x] Task 1: Add the `changeOrder` approval document type (migration)
- [x] Task 2: Apply the migration and regenerate DB types
- [x] Task 3: Approval engine and models support `changeOrder`
- [x] Task 4: Dataset validator exception
- [x] Task 5: Settings → Approval Rules shows a Change Notices card
- [x] Task 6: Approval notifications route and describe change notices
- [x] Task 7: Change notice server helpers (pending lock, validator, path)
- [x] Task 8: Change notice routes (submit, approve/reject, cancel, delete, loader)
- [x] Task 9: Change notice UI (header buttons, modal, edit lock)
- [x] Task 10: History CSV download
- [x] Task 11: End-to-end verification (browser walk-through passed; added change notice audit event triggers found during the test)

## Dependencies
- Task 2 needs Task 1. Tasks 3–10 need Task 2 (generated enum type).
- Tasks 3, 4, 6 and 10 are independent of each other.
- Task 5 needs Task 3 (labels). Task 8 needs Tasks 3 and 7. Task 9 needs Task 8.
- Task 11 needs all.

---

## Task 1: Add the `changeOrder` approval document type (migration)

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_change-order-approvals.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260310005407_supplier-approvals.sql:2-3,78-109`

**Steps:**
1. Run `pnpm db:migrate:new change-order-approvals`.
2. Write this SQL into the new file:

```sql
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'changeOrder';
COMMIT;

DROP VIEW IF EXISTS "approvalRequests";
CREATE OR REPLACE VIEW "approvalRequests" WITH (SECURITY_INVOKER=true) AS
SELECT
  ar."id", ar."documentType", ar."documentId", ar."status",
  ar."requestedBy", ar."requestedAt", ar."decisionBy", ar."decisionAt",
  ar."decisionNotes", ar."companyId", ar."createdAt",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN po."purchaseOrderId"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."name"
    WHEN ar."documentType" = 'supplier' THEN sup."name"
    WHEN ar."documentType" = 'changeOrder' THEN co."changeOrderId"
    ELSE NULL
  END AS "documentReadableId",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN s."name"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."description"
    WHEN ar."documentType" = 'supplier' THEN NULL
    WHEN ar."documentType" = 'changeOrder' THEN co."name"
    ELSE NULL
  END AS "documentDescription"
FROM "approvalRequest" ar
LEFT JOIN "purchaseOrder" po ON ar."documentType" = 'purchaseOrder' AND ar."documentId" = po."id"
LEFT JOIN "supplier" s ON po."supplierId" = s."id"
LEFT JOIN "qualityDocument" qd ON ar."documentType" = 'qualityDocument' AND ar."documentId" = qd."id"
LEFT JOIN "supplier" sup ON ar."documentType" = 'supplier' AND ar."documentId" = sup."id"
LEFT JOIN "changeOrder" co ON ar."documentType" = 'changeOrder' AND ar."documentId" = co."id" AND ar."companyId" = co."companyId";
```

**Verify:** file exists; `grep -c changeOrder` on it returns 5.
**Out of scope:** RLS, functions, triggers (approval logic lives in TypeScript).

## Task 2: Apply the migration and regenerate DB types

**Depends on:** 1
**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm db:types`.

**Verify:**
```bash
grep -n '"changeOrder"' packages/database/src/types.ts | grep -i approval | head
# Expected: approvalDocumentType union contains "changeOrder"
```
If `pnpm db:migrate` fails because the local DB is down, STOP and report.

## Task 3: Approval engine and models support `changeOrder`

**Depends on:** 2
**Files:**
- Modify: `packages/ee/src/approvals/models.ts` — add `"changeOrder"` to `approvalDocumentType`; add `changeOrder: "Change Notice"` to `approvalDocumentTypeLabel`.
- Modify: `packages/ee/src/approvals/service.ts` — `approveRequest`: add an `else if (documentType === "changeOrder")` branch after `supplier`. It updates `changeOrder` with `status: "Implementation"`, `updatedBy`, `updatedAt`, where `id = documentId`, `companyId = companyId`, `status = "Engineering Complete"`, returns `id`, and throws `"Failed to update change notice status - it may no longer be in 'Engineering Complete' state"` when no row comes back. `rejectRequest`: add a comment that `changeOrder` rejection does not change the status.

**Verify:** `pnpm --filter @carbon/ee typecheck` exits 0.

## Task 4: Dataset validator exception

**Depends on:** 2
**Files:** Modify `packages/database/src/datasets/validate.ts:251-256` — add `changeOrder: "the seed does not create change notice approval requests"` to the `enumValues("approvalDocumentType", {...})` map.
**Verify:** `pnpm db:check:datasets` passes (or reports only failures that exist on `main`; compare if it fails).

## Task 5: Settings → Approval Rules shows a Change Notices card

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/approval-rules.tsx` — `changeOrderRules` bucket; pass it to `ApprovalRules`.
- Modify: `apps/erp/app/routes/x+/settings+/approval-rules.new.tsx` — accept `typeParam === "changeOrder"`.
- Modify: `apps/erp/app/modules/settings/ui/Approvals/ApprovalRules.ee.tsx` — new `changeOrderRules` prop and a 4th card "Change Notices", description "Require approval before change notices move to Implementation". Copy the Suppliers card (New Rule only when `changeOrderRules.length === 0`).
- Modify: `apps/erp/app/modules/settings/ui/Approvals/ApprovalRuleCard.ee.tsx` — replace `approvalDocumentTypeLabel[documentType]` and the delete-name ternary with a Lingui map: `{ purchaseOrder: t\`Purchase Order\`, qualityDocument: t\`Quality Document\`, supplier: t\`Supplier\`, changeOrder: t\`Change Notice\` }`; delete name is `t\`${label} approval rule\``.

**Verify:** `pnpm --filter erp typecheck` exits 0.

## Task 6: Approval notifications route and describe change notices

**Depends on:** 2
**Files:**
- Modify: `packages/jobs/src/inngest/functions/notifications/content.ts` — in the approval case, add a `changeOrder` branch before the generic return: read `changeOrder` (`changeOrderId, name, status`) by `id` + `companyId`; description `Change notice ${changeOrderId} ${docPhrase}`, reference `changeOrderId`, details Name + Status. Fallback description `Change notice ${docPhrase}`.
- Modify: `apps/erp/app/routes/api+/link.ts` — `if (documentType === "changeOrder") return path.to.changeNoticeDetails(documentId);`
- Modify: `apps/erp/app/components/Layout/Topbar/Notifications.tsx` — approval `to` by `documentType`: qualityDocument → `path.to.qualityDocument(id)`, supplier → `path.to.supplierApproval(id)`, changeOrder → `path.to.changeNoticeDetails(id)`, else `path.to.purchaseOrderDetails(id)`.
- Modify: `packages/notifications/src/index.ts:15` — drop "no approval flow in v1" from the comment.

**Verify:** `pnpm --filter @carbon/jobs typecheck` and `pnpm --filter erp typecheck` exit 0.

## Task 7: Change notice server helpers (pending lock, validator, path)

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/items/items.models.ts` — add `changeNoticeApprovalValidator` (copy `qualityDocumentApprovalValidator`, `quality.models.ts:394-399`) and `changeNoticeAwaitingApprovalMessage = "This change notice is waiting for approval. Engineering changes are locked until it is approved or rejected."`.
- Modify: `apps/erp/app/utils/path.ts` — `changeNoticeApproval: (id) => generatePath(\`${x}/items/change-notice/${id}/approval\`)` (alphabetical, after `changeNoticeAffectedItem`).
- Modify: `apps/erp/app/modules/items/items.server.ts`:
  - `isChangeNoticeAwaitingApproval(changeNoticeId: string): Promise<boolean>` → `hasPendingApproval(getCarbonServiceRole(), "changeOrder", changeNoticeId)`.
  - `METHOD_LOCK_SOURCE` → `"changeOrder(id, status), item(revisionStatus)"`; `MethodLock` gets `changeNoticeId`; `resolveMethodLock` fills it.
  - `checkRevisionLock`: after the existing hard block, if `lock.changeNoticeStatus === "Engineering Complete"` and `lock.changeNoticeId` and the helper returns true → `{ ok: false, warn: false, message: changeNoticeAwaitingApprovalMessage }`.
  - `requireChangeNoticeEditable`: if scope is `engineering`, status is `Engineering Complete`, and the helper returns true → `{ error: { message: changeNoticeAwaitingApprovalMessage }, data: null }`.

**Verify:** `pnpm --filter erp typecheck` exits 0.
If `MethodLockRow` typing does not allow the extra `id`, widen that local type only.

## Task 8: Change notice routes

**Depends on:** 3, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/items+/change-notice+/$id.status.tsx`:
  1. If `fromStatus === "Engineering Complete" && toStatus === "Implementation"`: service role; pending → flash error "This change notice is already waiting for approval"; `isApprovalRequired(serviceRole, "changeOrder", companyId)` → `createApprovalRequest`, notify approvers (copy `quality-document+/update.tsx:58-104`), flash success "Submitted for approval", redirect. No status change.
  2. If `toStatus === "Cancelled"`: after a successful update, set any pending `changeOrder` request for `id` to `Cancelled` with the service role (copy the update in `quality-document+/update.tsx:178-187`).
- Create: `apps/erp/app/routes/x+/items+/change-notice+/$id.approval.tsx` — action only. Copy `quality-document+/$id.tsx:114-230`; use `update: "parts"`, `changeNoticeApprovalValidator`, `"changeOrder"`, redirect to `path.to.changeNoticeDetails(id)`. After an Approved result call `notifyChangeNoticeTransition({ client, event: changeNoticeStageEvent.Implementation, changeNoticeId: id, companyId, userId })`.
- Modify: `apps/erp/app/routes/x+/items+/change-notice+/delete.$id.tsx` — before the delete, cancel pending `changeOrder` requests for `id` with the service role.
- Modify: `apps/erp/app/routes/x+/items+/change-notice+/$id.tsx` — loader returns `approval` from new `getChangeNoticeApprovalContext` (in `items.server.ts`, copy `quality-document+/$id.tsx:52-104`): `{ requestId, isPending, canApprove, isApprovalRequired, lastRejection: { notes, decisionAt } | null }`; only queries when status is `Engineering Complete`.

**Verify:** `pnpm --filter erp typecheck` exits 0.

## Task 9: Change notice UI

**Depends on:** 8
**Files:**
- Create: `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeApprovalModal.tsx` — copy `modules/quality/ui/Documents/QualityDocumentApprovalModal.tsx`; action `path.to.changeNoticeApproval(id)`; all copy Lingui; approve text "This moves the change notice to Implementation."; reject text "The change notice stays at Engineering Complete."
- Modify: `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeHeader.tsx` (precedent `QualityDocumentHeader.tsx:72-200`):
  - At Engineering Complete + `isApprovalRequired` + not pending: Advance label `t\`Submit for Approval\``.
  - Pending: hide Advance; show `Pending Approval` badge; if `canApprove`, Approve + Reject buttons opening the modal.
  - `lastRejection` at Engineering Complete and not pending: `Approval Rejected` badge with tooltip (notes + date).
- Modify: `$id.details.tsx`, `$id.$affectedId.details.tsx`, `ChangeNoticeExplorer.tsx` — `isDisabled ||= approval?.isPending`; affected-item disabled reason gets the pending message (Lingui).

**Verify:** `pnpm --filter erp typecheck` exits 0.

## Task 10: History CSV download

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/routes/api+/audit-log.ts` — if `all === "true"`, loop `getEntityAuditLog` with `limit: 500` and growing `offset` until a page has fewer than 500 rows or 10,000 entries are collected.
- Modify: `apps/erp/app/components/AuditLog/useAuditLog.tsx` — optional `downloadable?: boolean`, `downloadName?: string`; pass to the drawer.
- Modify: `apps/erp/app/components/AuditLog/AuditLogDrawer.tsx` — `AuditLogFeed` gets `onEntryCountChange?(count)`; the drawer keeps the count in state and, when `downloadable && count > 0`, renders a Download button in `DrawerHeader`. On click: `fetch('/api/audit-log?...&all=true')`, build rows (columns per spec: Date, Changed By via `usePeople()`, Action, Record via `getTableLabel`, Record ID, Field, Old Value, New Value), `downloadCsv(rows, \`${downloadName ?? entityType}-history-${YYYY-MM-DD}.csv\`, { fields })`. Precedent: `components/Table/components/Download.tsx`.
- Modify: `ChangeNoticeHeader.tsx` — pass `downloadable: true`, `downloadName: changeOrderId`.

**Verify:** `pnpm --filter erp typecheck` exits 0.
**Out of scope:** other `useAuditLog` callers.

## Task 11: End-to-end verification

**Depends on:** all
**Steps:**
1. `pnpm --filter erp typecheck`, `pnpm --filter @carbon/ee typecheck`, `pnpm --filter @carbon/jobs typecheck` — exit 0.
2. `pnpm exec biome check` on every changed file — no errors.
3. `pnpm lingui:extract` — new strings extracted.
4. `pnpm db:check:datasets`.
5. Run the ERP app and walk the spec's acceptance criteria (approval flow + download).
