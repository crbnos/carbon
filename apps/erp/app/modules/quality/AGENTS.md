# Quality Module

Non-conformances (issues/NCRs), corrective/preventive actions (CAPAs), gauge management and calibration, quality documents, inspection documents with balloon annotations, inspections (source-generic: receipts and job operations) with AQL sampling plans, and risk registers.

## Key Domain Concepts

- **Issue (NCR)** — non-conformance record. Statuses: Registered → In Progress → Closed. `isIssueLocked(status)` returns true for Closed. Has 12 association types (items, customers, suppliers, job operations, PO/SO lines, shipment/receipt lines, tracked entities, inspections, RMA lines, supplier return lines).
- **Issue Workflow** — configurable multi-step workflow with action tasks (`nonConformanceActionTask`) and approval tasks (`nonConformanceApprovalTask`). Required actions have `systemType` (Containment, Corrective, Preventive, Verification, Communication) — system actions are protected by trigger.
- **Inspection Document** — PDF-based drawing with balloon annotations linking to inspection features (dimensions with nominal/tolerance values, optional per-feature sampling rules). Used for FAI, in-process inspection, and — via the item's Receipt-usage assignment — inbound inspection. MUST use `saveInspectionDocumentAtomic` RPC for atomic saves.
- **Inspection** — source-document-generic inspection (`sourceDocument`: Receipt or Job Operation; filterable in the list). Receipt-sourced lots are created on receipt posting for items that have a Receipt-usage inspection-document assignment (`itemInspectionDocumentAssignment`); Job Operation lots are created lazily by the MES inspection view (`/x/inspection/{jobOperationId}` in apps/mes) for operations with `operationType = 'Inspection'`, keyed to the operation's `inspectionDocumentId` FK. Uses AQL-based sampling plans (ANSI Z1.4 / ISO 2859-1), resolved **per feature**: feature rule → the inspection document's default rule → All (the per-item sampling plan tier was removed 2026-07-26; sampling is authored entirely in the document editor). Executed full-screen at `/x/inspection/{id}` (list at `/x/quality/inspections`; the document *editor* moved to `/x/inspection-document/{id}`): document-driven lots record measurements in a features × samples grid beside the ballooned drawing (sample status is derived, no override); lots without a document keep manual per-sample Pass/Fail. Tracked entities post as `On Hold` until released by measurement/sample results or disposition. All three terminal statuses (Passed/Failed/Partial) are hard-terminal (2026-07-27): the engine refuses sample/measurement writes on closed lots, and a sample whose verdict already drove a linked `productionQuantity` posting (MES job-op completion) is locked until the ERP deletes that row. **Job Operation lots are verdict-only in the ERP** — their physical outcome (complete / scrap / rework allocation) is orchestrated by the MES disposition route, which closes the lot one-shot (`dispositionInspection` `requireOpen`); receipt lots keep re-disposition (write-off retry) semantics. See `.claude/rules/inspection-system.md`.
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
| `inspectionDocument` | PDF drawing with balloon overlay |
| `inspection` / `inspectionSample` | Source-generic inspection lots with sampling; live `inspectionDocumentId` + `sourceDocument*` columns |
| `inspectionSamplingPlan` / `inspectionMeasurement` | Per-inspection resolved feature plans (n/Ac/Re) and per sample × feature readings |
| `itemInspectionDocumentAssignment` | Item × usage slot → inspection document (v1 usage: `Receipt`) |
| `gauge` / `gaugeCalibrationRecord` / `gaugeType` | Measurement instrument tracking |
| `qualityDocument` / `qualityDocumentStep` | Versioned SOPs. The document body is the editor content; `qualityDocumentStep` rows remain in the schema but have no authoring UI (the steps sidebar was removed) |
| `riskRegister` / `riskRegisters` (view) | Risk/opportunity tracking by source |

## Operations (`quality.server.ts`)

Each operation is one `defineServiceFn` const in `quality.server.ts`. A route calls it through `carbon(request)` as `api.quality.<name>(input)` and makes no other write; the API and MCP publish the ones tagged `@mcp` as `quality_<name>`. Every check the route used to make is in the function.

| Operation | Route | What it holds |
|---|---|---|
| `createIssue` | `x+/issue+/new.tsx` | Every referenced record must be the company's; tracked entities from the query string are linked; a job-operation issue links the operation's lot to its disposition row; tasks are created (a failure deletes the issue); integrations are told; `changeOrderId` links the issue onto the change notice (a failed link is `warning`) |
| `updateIssueField` | `x+/issue+/update.tsx` | Refused on a closed issue; `requiredActionIds` / `approvalRequirements` reconcile the tasks |
| `setIssueStatus` / `completeIssue` | `$id.status.tsx`, `$id.close.tsx` | Start and reopen only (reopen refused once the dispositions posted inventory); the issue must be the company's, and the write is scoped to it; close is `closeIssue`, which posts the dispositions |
| `draftIssueSupplierReturn` | `$id.supplier-return.tsx` | `purchasing` create; idempotent per covered quantity, deletes the draft on a part-way failure |
| `createIssueAssociation` | `$id.association.new.tsx` | Refused on a closed issue or one of another company; an item, customer, supplier or tracked entity must be the company's; an inspection links its whole lot under the issue lock |
| `updateIssueItemField` | `item+/update.tsx` | Disposition from the picker's subset; quantity is a compare-and-set |
| `setIssueTaskStatus` / `setIssueTaskSupplier`, `setIssueActionDueDate` / `reorderIssueActionTasks` | `task.$id.status.tsx`, `task.supplier.tsx`, `action.$id.due-date.tsx`, `action-tasks.order.tsx` | The supplier must be the company's; a reorder takes the tasks of one issue and writes them with `updateSortOrder` |
| `rejectInspection` | `x+/inspection+/$id.reject.tsx` | Receipt lots only; the non-tracked write-off posts before any issue opens; the issue's disposition row takes the lot as Scrap |
| `saveInspectionDocument` / `setInspectionDocumentDrawingNumber` | `x+/inspection-document+/$id.save.tsx`, `$id.update-name.tsx` | Legacy balloons need anchors; `pdfUrl` must be a safe key in the company's folder (its `/file/preview/private/` form or the bare key); the default sampling rule is saved before the atomic RPC |
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
- `closeIssue` (`quality.service.ts`) — blocked while a linked supplier return is open; the 'Return to Supplier' write-off is reduced by shipped-via-return coverage, and return-shipped entities stay Consumed (not flipped Rejected). `draftIssueSupplierReturn` drafts the linked `purchaseReturnOrder` (idempotent, supplier auto-resolution)
- `getInspectionDocument` / `getBalloons` / `getInspectionFeatures` / `getInspectionPlan` — drawing-inspection reads (plan authoring: `getInspectionDocuments`, `upsertInspectionDocument`, `deleteInspectionDocument`, `saveInspectionDocumentAtomic`; editor UI in `ui/InspectionDocument/`, list at `/x/quality/inspection-plans`; the editor autosaves — merge logic in `ui/InspectionDocument/autosave.ts`)
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
