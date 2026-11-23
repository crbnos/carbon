# Quality Module

Non-conformances (issues/NCRs), corrective/preventive actions (CAPAs), gauge management and calibration, quality documents, inspection documents with balloon annotations, inspections (source-generic: receipts and job operations) with AQL sampling plans, and risk registers.

## Key Domain Concepts

- **Issue (NCR)** — non-conformance record. Statuses: Registered → In Progress → Closed. `isIssueLocked(status)` returns true for Closed. Has 12 association types (items, customers, suppliers, job operations, PO/SO lines, shipment/receipt lines, tracked entities, inspections, RMA lines, supplier return lines).
- **Issue Workflow** — configurable multi-step workflow with action tasks (`nonConformanceActionTask`) and approval tasks (`nonConformanceApprovalTask`). Required actions have `systemType` (Containment, Corrective, Preventive, Verification, Communication) — system actions are protected by trigger.
- **Inspection Document** — PDF-based drawing with balloon annotations linking to inspection features (dimensions with nominal/tolerance values, optional per-feature sampling rules). Used for FAI, in-process inspection, and — via the item's Receipt-usage assignment — inbound inspection. MUST use `saveInspectionDocumentAtomic` RPC for atomic saves. A plan can also be made from a STEP model's PMI (`modelUploadId` set, no PDF; features carry `pmiItemId`) by the `pmi-inspection-plan` job — see `.claude/rules/inspection-system.md`.
- **Inspection** — source-document-generic inspection (`sourceDocument`: Receipt, Job Operation or Manual; filterable in the list). Manual lots are created by hand for specific tracked entities of one item (`createManualInspection`, optional work center and assignee, entities listed in `inspectionTrackedEntity`) and hold / release / reject their entities as receipt lots do. Receipt-sourced lots are created on receipt posting for items that have a Receipt-usage inspection-document assignment (`itemInspectionDocumentAssignment`); Job Operation lots are created lazily by the MES inspection view (`/x/inspection/{jobOperationId}` in apps/mes) for operations with `operationType = 'Inspection'`, keyed to the operation's `inspectionDocumentId` FK. Uses AQL-based sampling plans (ANSI Z1.4 / ISO 2859-1), resolved **per feature**: feature rule → the inspection document's default rule → All (the per-item sampling plan tier was removed 2026-07-26; sampling is authored entirely in the document editor). Executed full-screen at `/x/inspection/{id}` (list at `/x/quality/inspections`; the document *editor* moved to `/x/inspection-document/{id}`): document-driven lots record measurements in a features × samples grid beside the ballooned drawing (sample status is derived, no override); lots without a document keep manual per-sample Pass/Fail. Tracked entities post as `On Hold`; on a receipt or manual lot they stay On Hold until the lot is decided (a sample verdict only records an Inspect activity), and the decision sets each unit Available or Rejected. All three terminal statuses (Passed/Failed/Partial) are hard-terminal (2026-07-27): the engine refuses sample/measurement writes on closed lots, and a sample whose verdict already drove a linked `productionQuantity` posting (MES job-op completion) is locked until the ERP deletes that row. **Job Operation lots are verdict-only in the ERP** — their physical outcome (complete / scrap / rework allocation) is orchestrated by the MES disposition route, which closes the lot one-shot (`dispositionInspection` `requireOpen`); a receipt lot is decided once by the engine itself, and only Reject repeats on a Failed lot, which writes off nothing new; a manual lot's decision is final. See `.claude/rules/inspection-system.md`.
- **Goods-in inspection hold** — a receipt lot holds its stock in its `storageUnitId` until decided, once; Reject and Partial move rejected stock to the location's rejected storage unit on its project stripe; an untracked Partial records `acceptedQuantity`, needs an NCR, and holds the rest until that NCR closes; an untracked Partial is refused when the held unit holds less than it takes, and an untracked Reject writes off what is there; a voided receipt's open lots become `Cancelled`. An untracked receipt lot belongs to one NCR unless it Passed, and a Partial lot must be the only lot on its NCR and cannot be decided against a Closed one. BEFORE interceptors refuse releasing the hold by a direct edit of `inspection` (a DELETE of a lot that holds stock too), `trackedEntity` (a DELETE of a held unit too), `item` (its tracking type while a receipt lot is open or holds its remainder), a goods-in `storageUnit` (made inactive), `location` (an inactive goods-in unit) or `nonConformance` (closing the NCR of a Partial lot's held remainder outside `closeIssue`, or reopening an NCR that released one). A PO line its project consumes at receipt opens no lot. See `.claude/rules/inspection-system.md` → Goods-in inspection hold.
- **Gauge** — measurement instrument with calibration tracking. Statuses: Active/Inactive. Roles: Master/Standard.
- **Disposition** — per-item outcome on an NCR. Values include Pending, Return to Supplier, Rework, Scrap, Use As Is (subset active in UI).
- **Risk Register** — risks and opportunities tracked by source (Customer, Supplier, Item, Job, etc.). Severity and likelihood are independent 1–5 ratings with no computed score.

## Safety

### Always
- MUST check `isIssueLocked(status)` before allowing edits — Closed issues are locked.
- MUST use `deleteIssueAssociation` with the `type` parameter for managing NCR links — it handles 10+ association types via `nonConformanceAssociationType`.
- MUST scope all queries by `companyId`.
- MUST take `lockIssueDispositions` (`@carbon/database/quality`) first, inside the transaction, before inserting `nonConformanceItemTrackedEntity` / `nonConformanceInspection` rows or changing `nonConformanceItem.quantity` — the inline quantity edit's link and inspection checks rely on every such writer holding it. See `.claude/rules/issue-module.md`.
- MUST use `saveInspectionDocumentAtomic` RPC for inspection document saves — it handles balloons and features atomically.

### Ask First
- Closing issues that have incomplete required actions or pending approval tasks.
- Deleting inspection documents that have recorded measurements.
- Deactivating gauges with active calibration records.

### Never
- Delete gauges with calibration records — deactivate instead (`deactivateGauge`).
- Bypass workflow task/approval requirements when closing an issue.
- Hard-delete issue workflows — use `deleteIssueWorkflow` which handles deactivation.
- Introduce a `score` column on risk register — severity and likelihood are kept separate by design.

## Validation Commands

```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1   # the package is "erp", not "@carbon/erp"
pnpm --filter erp test
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `nonConformance` / `issues` (view) | Issue/NCR header: status, priority, source, type, assignee, containmentStatus |
| `nonConformanceType` / `nonConformanceWorkflow` | Issue categories and workflow definitions |
| `nonConformanceRequiredAction` | Actions required before closure (with `systemType`) |
| `nonConformanceActionTask` / `nonConformanceApprovalTask` | Workflow task instances |
| `nonConformanceItem` | Issue-to-item junction with `disposition` |
| `nonConformanceCustomer` / `...Supplier` / `...JobOperation` / `...PurchaseOrderLine` / `...ReceiptLine` / `...ShipmentLine` / `...TrackedEntity` / `...Inspection` / `...SalesReturnOrderLine` / `...PurchaseReturnOrderLine` | Association tables (12 types). The purchase-return junction carries a `quantity` — per-quantity ownership for the supplier-return bridge |
| `inspectionDocument` | PDF drawing with balloon overlay. Versioned: `status` Draft / Active / Archived, versions grouped by `rootInspectionDocumentId ?? id`; only a Draft is editable. `workInstruction` (Tiptap JSON) is the plan's work instructions, read live by every lot |
| `inspectionDocumentParameter` | A plan's fixed key/value parameters, read live by every lot; saved as a whole list by `replaceInspectionDocumentParameters` inside `saveInspectionDocument` |
| `inspection` / `inspectionSample` | Source-generic inspection lots with sampling; live `inspectionDocumentId` + `sourceDocument*` columns |
| `inspectionSamplingPlan` / `inspectionMeasurement` | Per-inspection resolved feature plans (n/Ac/Re) and per sample × feature readings |
| `inspectionTrackedEntity` | The tracked entities a manual inspection covers |
| `itemInspectionDocumentAssignment` | Item × usage slot → inspection document (v1 usage: `Receipt`) |
| `gauge` / `gaugeCalibrationRecord` / `gaugeType` | Measurement instrument tracking |
| `qualityDocument` / `qualityDocumentStep` | Versioned SOPs. The document body is the editor content; `qualityDocumentStep` rows remain in the schema but have no authoring UI (the steps sidebar was removed) |
| `riskRegister` / `riskRegisters` (view) | Risk/opportunity tracking by source |

## Operations (`quality.server.ts`)

Each operation is one `defineServiceFn` const in `quality.server.ts`. A route calls it through `carbon(request)` as `api.quality.<name>(input)` and makes no other write; the API and MCP publish the ones tagged `@mcp` as `quality_<name>`. Every check the route used to make is in the function.

| Operation | Route | What it holds |
|---|---|---|
| `createIssue` | `x+/issue+/new.tsx` | Every referenced record (a `supplierId` included, written as the issue's `nonConformanceSupplier`) must be the company's; tracked entities from the query string are linked, and each one still in stock goes onto its item's disposition row, at what it holds (`linkIssueTrackedEntities`, under the issue lock; a failed link deletes the issue); a job-operation issue links the operation's lot to its disposition row; tasks are created (a failure deletes the issue); integrations are told; `changeOrderId` links the issue onto the change notice (a failed link is `warning`) |
| `updateIssueField` | `x+/issue+/update.tsx` | Refused on a closed issue; `requiredActionIds` / `approvalRequirements` reconcile the tasks |
| `setIssueStatus` / `completeIssue` | `$id.status.tsx`, `$id.close.tsx` | Start and reopen only (reopen refused once the dispositions posted inventory); the issue must be the company's, and the write is scoped to it; close is `closeIssue`, which posts the dispositions |
| `draftIssueSupplierReturn` | `$id.supplier-return.tsx` | `purchasing` create; idempotent per covered quantity, deletes the draft on a part-way failure |
| `createIssueAssociation` | `$id.association.new.tsx` | Refused on a closed issue or one of another company; an item, customer, supplier or tracked entity must be the company's; an inspection links its whole lot under the issue lock |
| `updateIssueItemField` | `item+/update.tsx` | Disposition from the picker's subset; quantity is a compare-and-set |
| `setIssueTaskStatus` / `setIssueTaskSupplier`, `setIssueActionDueDate` / `reorderIssueActionTasks` | `task.$id.status.tsx`, `task.supplier.tsx`, `action.$id.due-date.tsx`, `action-tasks.order.tsx` | The supplier must be the company's; a reorder takes the tasks of one issue and writes them with `updateSortOrder` |
| `createManualInspection` | `x+/quality+/inspections.new.tsx` | Entities of one item, Available or On Hold, in no other open inspection; Available ones go On Hold; sampling from the chosen plan, which must be an Active version of the item's own plans. The New Inspection drawer requires a plan (the operation does not); on success it toasts a link to the lot and returns to the list |
| `cancelManualInspection` / `deleteManualInspection` | `x+/inspection+/$id.cancel.tsx`, `$id.delete.tsx` | Manual lots only. Cancel: an open lot becomes Cancelled (terminal, off the shop floor queue, recordings kept). Delete: only while nothing is recorded. Both give each held entity its status from before the lot (`inspectionTrackedEntity.previousStatus`) |
| `rejectInspection` / `partialInspection` | `x+/inspection+/$id.reject.tsx`, `$id.partial.tsx` | Reject takes Receipt and Manual lots, Partial Receipt lots only. Reject: `requireOpen` (the MES sends it) refuses a decided lot, and a closed manual lot is refused either way; the non-tracked write-off posts from the held unit in the decision's transaction (a failed write-off leaves the lot open), before any issue opens; the issue's disposition row takes the lot as Scrap; the lot's `supplierId` becomes the issue's supplier. Partial: an untracked lot needs `acceptedQuantity` and an NCR, whose prerequisites (`inspectionNcrPrerequisite`) are checked before the lot closes; a serial Partial needs a failed unit, a passed sample and complete sampling, then accepts every unit that did not fail and rejects the failed ones; with `createNcr` its prerequisites are checked before the lot closes too; a batch or non-inventory lot cannot be Partial. A receipt lot is decided once: only Reject repeats on a Failed lot, which writes off nothing new, keeps the first decision's notes and `dispositionedBy` / `dispositionedAt`, adds no `inspectionHistory` row, and can open a missing NCR. A Partial lot whose NCR did not open (untracked, or serial with failed units) gets it from Partial again, unless its receipt was voided, which opens the NCR and decides nothing. Both open the NCR through `openInspectionNcr`; the Reject write-off posts one movement per project stripe |
| `attachInspectionDocumentModel` | `x+/inspection-document+/$id.model.tsx` | A staged STEP model on a Draft plan with no PDF and no model: one transaction locks the plan, inserts the `modelUpload` as the system with no item link and points the plan at it; `model-optimize` starts after the commit |
| `createInspectionDocumentVersion` / `activateInspectionDocumentVersion` / `deleteInspectionDocument` | `x+/inspection-document+/$id.version.tsx`, `$id.activate.tsx`, `$id.delete.tsx` | New Version copies the plan (characteristics, balloons, parameters, work instructions) into a Draft one past the highest version; Publish archives the Active version and moves item receipt assignments and method operations to it; delete refuses a version a lot used, re-roots the other versions and keeps a PDF another version holds. Every plan write refuses a version that is not a Draft: the lock is in the write itself (`status = 'Draft'` in the UPDATE, `inspectionDocumentWriteRefusal`); `save_inspection_document_atomic` refuses a non-Draft version under the plan's row lock |
| `saveInspectionDocument` / `setInspectionDocumentName` / `setInspectionDocumentWorkInstruction` | `x+/inspection-document+/$id.save.tsx`, `$id.update-name.tsx`, `$id.update-work-instruction.tsx` | Legacy balloons need anchors; `pdfUrl` must be a safe key in the company's folder (its `/file/preview/private/` form or the bare key); the default sampling rule and the `parameters` list (when sent) are saved before the atomic RPC |
| `updateQualityDocumentField` / `decideQualityDocumentApproval` / `seedQualityDocuments` | `x+/quality-document+/update.tsx`, `$id.tsx`, `api+/quality.documents.seed.ts` | Activating opens approval requests when a rule applies; Archived / Draft withdraw a pending one |
| `createRisk` / `updateRisk` | `x+/quality+/risks.new.tsx`, `risks.$id.tsx` | The assignee is notified; create is gated on company membership (the table's RLS limits it to employees) and is not published |
| `setScarTaskStatus` / `updateScarTaskNotes` | `share+/scar.$id.tsx` | `system` only: the route builds the context from the share link (`scarLinkContext`); the issue must be open and the task the supplier's |
| `updateIssueWorkflowField` | `x+/issue-workflow+/update.tsx` | Gated on `production` update, as the route was; not published |

The building blocks they call (`updateIssueStatus`, `updateIssueTaskStatus`, `upsertRisk`) are in `quality.service.ts` and are never tools. The published `updateIssue`, `createQualityDocument` and `updateQualityDocument` write only their listed fields and never `status`: an issue moves through `setIssueStatus` / `completeIssue` (and `updateIssue` refuses a closed one), a quality document through its approvals (`updateQualityDocumentField`). Gauge activate / deactivate need `quality` update and delete, a calibration record or issue workflow update create and update (the old route's gate and the row's policy). `insertIssue` is its own published service function because a workflow action calls it (`quality_insertIssue`).

## Key Service Functions

- `getIssue` / `getIssues` — NCR reads; `getIssues` reads `issues` view with computed `containmentStatus`
- `getIssueAssociations` / `getIssueItems` / `getIssueReviewers` — NCR details and associations
- `getIssueWorkflow` / `getIssueActionTasks` / `getIssueApprovalTasks` — workflow state
- `updateIssueStatus` / `updateIssueTaskStatus` — the bare status writes under `setIssueStatus` / `setIssueTaskStatus`
- `closeIssue` (`quality.service.ts`) — in one transaction closes the NCR first under `withInspectionRelease` (closing releases a Partial lot's held remainder, which `check_nonconformance_inspection_release` refuses otherwise), then posts the write-off and changes units with the hold guard on; blocked while a linked supplier return is open, when a Partial lot sits beside another lot, and when a Partial untracked lot's item has no disposition row; the 'Return to Supplier' write-off is reduced by shipped-via-return coverage (an inspection-rejected non-tracked lot was written off at the reject; its return shipment puts the units back before shipping them, so close posts nothing for it), and return-shipped entities stay Consumed (not flipped Rejected). `draftIssueSupplierReturn` drafts the linked `purchaseReturnOrder` (idempotent, supplier auto-resolution)
- `getInspectionDocument` / `getBalloons` / `getInspectionFeatures` / `getInspectionPlan` — drawing-inspection reads (plan authoring: `getInspectionDocuments`, `getInspectionPlanParts` (the list, one row per part from the `inspectionPlanParts` view), `upsertInspectionDocument`, `deleteInspectionDocument`, `saveInspectionDocumentAtomic`; editor UI in `ui/InspectionDocument/`, list at `/x/quality/inspection-plans`; the editor autosaves — merge logic in `ui/InspectionDocument/autosave.ts`)
- `getInspection` / `getInspections` (status + source filters) / `getInspectionTrackedEntities` — inspections
- `getInspectionSamplingPlans` / `getInspectionMeasurements` — per-inspection feature plans and grid readings
- `getItemInspectionDocumentAssignments` / `upsertItemInspectionDocumentAssignment` — Receipt-usage document assignment
- `upsertInspectionMeasurement` / `reconcileInspectionSamplingPlans` / `changeInspectionDocument` (`quality.service.ts`) — measurement recording, lazy plan resolution, document swap; `valuateMeasurement` (pure valuation) comes from `@carbon/database/quality`. The transactional engine lives in `@carbon/database/quality` (shared with the MES inspection routes); the `quality.service.ts` wrappers take the caller's `db` (a route's `getDatabaseClient()`, a service function's `ctx.asSystem.pg`) and pass it to those engine calls, and also holds the plan editor's server-only helpers (legacy save-payload translation, the balloon-region vision call)
- `getGauge` / `getGauges` / `getGaugeCalibrationRecords` — gauge management
- `getRisk` / `getRisks` / `upsertRisk` — risk register (`upsertRisk` is the bare write under `createRisk` / `updateRisk`)
- `getQualityDocument` / `getQualityDocumentSteps` — versioned SOPs
- `getQualityActions` — corrective/preventive action reads

## Key Exports

```typescript
import { getIssue, getIssues, upsertRisk } from "~/modules/quality/quality.service";
import { isIssueLocked, nonConformanceStatus, riskSource, disposition } from "~/modules/quality/quality.models";
import { inspectionDocumentValidator, riskRegisterValidator } from "~/modules/quality/quality.models";
```

## Related Modules

- **inventory** — inbound inspections triggered on receipt; tracked entities linked to NCRs; `On Hold` status until disposition
- **production** — job operations can be NCR associations; scrap reasons shared with production
- **purchasing** — PO lines and receipt lines can be NCR associations; supplier NCRs
- **sales** — SO lines and shipment lines can be NCR associations; customer NCRs
- **items** — items linked to NCRs via `nonConformanceItem`; inbound inspection driven by the item's Receipt-usage inspection-document assignment; inspection documents reference parts

## Rules References

- `.claude/rules/issue-module.md` — NCR status lifecycle, workflow tasks, associations, and route structure
- `.claude/rules/risk-register-module.md` — risk register schema, enums, and entity integration
- `.claude/rules/inspection-system.md` — inspection execution flow, sampling engine, and disposition
