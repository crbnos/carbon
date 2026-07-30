# Quality Module

Non-conformances (issues/NCRs), corrective/preventive actions (CAPAs), gauge management and calibration, quality documents, inspection documents with balloon annotations, inspections (source-generic: receipts and job operations) with AQL sampling plans, and risk registers.

## Key Domain Concepts

- **Issue (NCR)** — non-conformance record. Statuses: Registered → In Progress → Closed. `isIssueLocked(status)` returns true for Closed. Has 10+ association types (items, customers, suppliers, job operations, PO/SO lines, shipment/receipt lines, tracked entities, inspections).
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
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `nonConformance` / `issues` (view) | Issue/NCR header: status, priority, source, type, assignee, containmentStatus |
| `nonConformanceType` / `nonConformanceWorkflow` | Issue categories and workflow definitions |
| `nonConformanceRequiredAction` | Actions required before closure (with `systemType`) |
| `nonConformanceActionTask` / `nonConformanceApprovalTask` | Workflow task instances |
| `nonConformanceItem` | Issue-to-item junction with `disposition` |
| `nonConformanceCustomer` / `...Supplier` / `...JobOperation` / `...PurchaseOrderLine` / `...ReceiptLine` / `...ShipmentLine` / `...TrackedEntity` / `...Inspection` | Association tables (10+ types) |
| `inspectionDocument` | PDF drawing with balloon overlay |
| `inspection` / `inspectionSample` | Source-generic inspection lots with sampling; live `inspectionDocumentId` + `sourceDocument*` columns |
| `inspectionSamplingPlan` / `inspectionMeasurement` | Per-inspection resolved feature plans (n/Ac/Re) and per sample × feature readings |
| `itemInspectionDocumentAssignment` | Item × usage slot → inspection document (v1 usage: `Receipt`) |
| `gauge` / `gaugeCalibrationRecord` / `gaugeType` | Measurement instrument tracking |
| `qualityDocument` / `qualityDocumentStep` | Versioned SOPs with ordered steps |
| `riskRegister` / `riskRegisters` (view) | Risk/opportunity tracking by source |

## Key Service Functions

- `getIssue` / `getIssues` — NCR reads; `getIssues` reads `issues` view with computed `containmentStatus`
- `getIssueAssociations` / `getIssueItems` / `getIssueReviewers` — NCR details and associations
- `getIssueWorkflow` / `getIssueActionTasks` / `getIssueApprovalTasks` — workflow state
- `updateIssueStatus` / `updateIssueTaskStatus` — status transitions
- `getInspectionDocument` / `getBalloons` / `getInspectionFeatures` / `getInspectionPlan` — drawing-inspection reads; NOTE these live in `production.service.ts`, not this module
- `getInspection` / `getInspections` (status + source filters) / `getInspectionTrackedEntities` — inspections
- `getInspectionSamplingPlans` / `getInspectionMeasurements` — per-inspection feature plans and grid readings
- `getItemInspectionDocumentAssignments` / `upsertItemInspectionDocumentAssignment` — Receipt-usage document assignment
- `upsertInspectionMeasurement` / `reconcileInspectionSamplingPlans` / `changeInspectionDocument` / `valuateMeasurement` (quality.server.ts) — measurement recording, lazy plan resolution, document swap, pure valuation. The transactional engine lives in `@carbon/database/quality` (shared with the MES inspection routes); quality.server.ts is thin wrappers currying the ERP Kysely singleton
- `getGauge` / `getGauges` / `getGaugeCalibrationRecords` — gauge management
- `getRisk` / `getRisks` / `upsertRisk` / `updateRiskStatus` — risk register
- `getQualityDocument` / `getQualityDocumentSteps` — versioned SOPs
- `getQualityActions` — corrective/preventive action reads

## Key Exports

```typescript
import { getIssue, getIssues, upsertRisk, isIssueLocked } from "~/modules/quality";
import { nonConformanceStatus, riskSource, disposition } from "~/modules/quality";
import { inspectionDocumentValidator, riskRegisterValidator } from "~/modules/quality";
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
