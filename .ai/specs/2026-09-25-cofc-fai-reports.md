# Certificates of Conformance and AS9102 First Article Inspection Reports

> Status: implemented on branch highest-value-feature-ideas (2026-09-26); not yet merged
> Author: barbinbrad (Claude, autonomous feature run)
> Date: 2026-09-25
> Research: [.ai/research/cofc-fai-reports.md](../research/cofc-fai-reports.md)
> Run record: `.ai/runs/2026-09-25-cofc-fai-reports.md`

## TLDR

Turn the inspection and traceability data Carbon already records into the two
documents aerospace/defense customers require before they accept parts:

1. **Certificate of Conformance (CofC)** — one signed certificate per posted shipment in
   the AS9163 14-field layout, listing every shipped lot/serial, the material and
   process certificates behind them, FAI references, concessions/NCRs, and
   customer/item compliance statements. Issued certificates are stored PDFs with
   numbered revisions, emailed to the customer; customers can be flagged so posting a
   shipment issues and emails one automatically. Never exposed in the (unauthenticated)
   customer portal.
2. **AS9102 Rev C First Article Inspection (FAI)** — an **inspection lot** of a new
   source, `First Article`, run with the item's inspection plan at 100% on one unit,
   from the ERP or the shop floor like any other inspection. Carbon **generates** it at
   job release for every item on the job that needs one (new revision, or a 2-year
   production lapse). A thin `firstArticleInspection` record adds only what an inspection
   lacks: the Form 1 header, Form 2 rows, and the Rev C signatures. Approval stores the
   FAIR PDF as the permanent record.

Supporting pieces: a `certificate` record for supplier material/process certs on receipt
lines or job operations; one lineage resolver shared by both documents; designator +
reference location + drawing revision + GD&T bonus tolerance (MMC/LMC) on the inspection
plan; per-reading notes; and three fixes to the inspection system itself — feature
deletes can no longer wipe recorded results, Inspection operations can no longer be
completed around their inspection, and plans can only sit on Inspection operations.
SPC/Cpk is a separate, later spec.

## Problem Statement

AS9100 shops cannot ship without a Certificate of Conformance, and cannot ship a new or
changed part without a First Article Inspection Report. Carbon records every input —
inspection plans (`inspectionDocument` / `inspectionFeature`, ballooned or manual
rows), per-feature measurements (`inspection` → `inspectionSample` →
`inspectionMeasurement`), lot/serial lineage, shipments and NCRs — but produces neither
document, and nothing tells a shop that a job needs an FAI. Customers re-type results
into an Excel AS9102 template or a separate tool (Net-Inspect, DISCUS, High QA) and
hand-write CofCs.

Concrete gaps (research file, "What Carbon already has"):

- No CofC or FAIR document, template type, or route.
- Supplier mill/process certs are bare storage objects under
  `${companyId}/inventory/${receiptLineId}` with no number, spec, or type.
- `inspectionFeature` has no characteristic designator (Key/Critical), no drawing
  sheet/zone; `inspectionDocument` has no drawing revision.
- GD&T callouts with Ⓜ/Ⓛ are evaluated against the stated tolerance only.
- Readings can't carry a note (the `notes` column exists; neither grid lets you enter it),
  so a note/test characteristic can't record "Applied" or a lab report number.

Defects found in the inspection system while designing this (fixed here):

- **Feature deletes wipe results.** `inspectionMeasurement → inspectionFeature` and
  `inspectionSamplingPlan → inspectionFeature` are `ON DELETE CASCADE`, and
  `save_inspection_document_atomic` deletes features on request — editing a plan
  silently deletes every recorded result for that feature, on every lot, including
  closed receiving lots.
- **Inspection operations can be completed around their inspection.** The MES
  traveler "Complete" scan (`apps/mes/app/routes/x+/end.$operationId.tsx`, printed for
  every operation by `jobTraveler/OperationsBlock.tsx:16,73`; also targeted by the ERP
  kanban `api+/kanban.complete.$id.tsx:49`) and a direct POST to `complete.tsx` post good
  quantity on an `Inspection` operation with no inspection lot or verdict.
- **A plan on a non-Inspection operation is silently ignored.** The ERP normalizer
  (`shared.models.ts:146-171`) keeps `inspectionDocumentId` only for `Inspection`
  operations, but nothing in the database enforces it; an API write can attach a plan
  the MES will never run.

## Proposed Solution

### Overview

```
part's First Article slot ─┐
  (else the part's only     ├─► inspection (source 'First Article', 1 unit, every feature)
   plan; else blocked)      │      ├─ samples/measurements: existing engine, ERP + MES UIs
job release ────────────────┘      ├─ NCRs: existing reject flow
                                   └─ firstArticleInspection (Form 1 header, signatures)
                                        ├─ firstArticleInspectionProduct (Form 2 rows)
                                        │     ▲ seeded by getCertificationLineage
receipt line / job op ─► certificate ───────┘     ▼ also feeds CofC field 13
shipment + shipped lots ────────────────────────► certificateOfConformance (issued PDFs)
```

### 1. Certificates (supplier material / process / test certs)

A `certificate` row records one certificate document: type (Material, Special Process,
Functional Test, Other), certificate number, specification text (e.g. "AMS 4911
Ti-6Al-4V"), supplier, notes, and an optional `documentId` pointing at the uploaded PDF's
existing `document` row. It attaches to exactly one of:

- a **receipt line** — covers every lot received on it (a mill cert for a heat, an outside
  processor's cert arriving with the processed parts);
- a **job operation** — an in-house special process or functional test.

Captured from the receipt line's actions menu ("Certificates") and from the FAI's Form 2
("Attach certificate" to a job operation). Upload reuses the receipt-line upload path and
`upsertDocument` (`sourceDocument = 'Receipt'` or `'Job'`), then inserts the
`certificate` row.

### 2. Certification lineage resolver

`getCertificationLineage(client, companyId, input)` in `quality.service.ts`, one
implementation for both documents. Input is `{ trackedEntityIds }` (CofC: shipped lots)
or `{ jobId, jobMakeMethodId?, trackedEntityId? }` (FAI). Output:
`CertificationLineageRow[]` — `{ kind, name, specification, supplierId, supplierName,
certificateId, certificateNumber, documentId, receiptLineId, jobOperationId,
trackedEntityIds[], missing }`.

1. **Materials** — start entities (shipped lots; or the FAI unit plus the job's consumed
   lots from `itemLedger` "Job Consumption" rows, whose `documentId` is the internal
   `job.id`) → `get_direct_descendants_of_tracked_entities_strict` repeatedly (Carbon's
   "descendants" RPC walks input ← output, i.e. back to what a part consumed; depth cap 12,
   visited set) → received roots (entities whose `attributes` carry `Receipt Line`,
   written in production by post-receipt / `update_receipt_line_batch_tracking`) →
   certificates on those receipt lines. A received root without one → `missing: true`.
2. **Special processes** — the job's `Outside Processing` operations →
   `purchaseOrderLine.jobOperationId` → receipt lines of those PO lines → certificates;
   none → `missing: true` (outside-processing receipts write no tracked-entity rows, so
   this path goes through the PO link).
3. **Job-operation certificates** — certificates attached to the job's operations.
4. **Non-tracked materials** (FAI only) — the make method's `jobMaterial` rows whose item
   is a `Material` without batch/serial tracking → `missing: true` rows so Form 2 lists
   every material the BOM consumed.

De-duplicated by certificate (or by receipt line / operation for missing rows).

### 3. Certificate of Conformance

**Layout** — the AS9163 / EN 9163 template (IAQG SCMH 5.2.4 Rev B), fields numbered
1–14, every field printed ("N/A"/"None" when empty, 9163 §5.2):

| # | Field | Source |
|---|---|---|
| 1 | Page Number | renderer ("Page n of m") |
| 2 | Certificate Number | `certificateOfConformance.certificateId` + revision suffix (`withRevisionSuffix`) |
| 3 | Date | `signedAt` (issue) / today (preview) |
| 4 | Organization Name and Address | `company` |
| 5 | Customer Name and Address | shipment customer + ship-to location |
| 6 | Purchase Order Number | sales order `customerReference` (Sales Order shipments) |
| 7 | Item Number | sales order line position + customer part number when mapped, else our part number |
| 8 | Quantity | `shipmentLine.shippedQuantity` + UoM |
| 9 | Description | item name |
| 10 | Revision | customer part revision when mapped, else `item.revision` ("N/C" when none) |
| 11 | Traceability | shipped lots/serials of the line (`getShipmentLineTracking`) with quantity each |
| 12 | Remarks | "None" (template-editable) |
| 13 | Conformity Details | shelf-life expiry of shipped lots; FAI identifiers (latest approved FAI per shipped item); material and process certificates (resolver over shipped lots); NCRs / concessions (`nonConformanceShipmentLine`, `nonConformanceTrackedEntity`); compliance statements; reason for update (revisions ≥ 1) |
| 14 | Statement of Conformity + signer | fixed 9163 statement; "Document electronically generated and validated."; signer printed name, title, date |

Field 14 statement (9163 §4.2): *"It is hereby certified that apart from the deviations,
concessions, or waivers noted in "Conformity Details", the product(s) / service(s)
detailed above has (have) been manufactured / maintained / reworked / performed /
inspected / tested and conform to applicable specifications, drawings, and purchase
order and contract requirements."*

**Template** — new document template type `certificateOfConformance` in the existing
customizer. It reuses the shared `header`, `parties`, `details`, `lineItems`, `notes`
blocks and adds two built-in blocks, `conformityDetails` (13) and `conformityStatement`
(14), plus the standard extension blocks.

**Lifecycle** — a CofC is an *issued* record:

- **Preview** (`file+/shipment+/$id.certificate[.]pdf.tsx`): live, watermarked
  "PREVIEW — NOT ISSUED".
- **Issue** (`x+/shipment+/$shipmentId.certificate.tsx`): Posted shipments only. In one
  Kysely transaction: sequence (revision 0), render, upload, `document` row
  (`sourceDocument = 'Shipment'`), `certificateOfConformance` row with the signer snapshot
  (user full name, `employeeJob.title`, time).
- **Reissue** — required "reason for update"; revision n+1 with the same number, reason
  printed in field 13; earlier revisions stay downloadable.
- **Download issued** — the stored PDF, never re-rendered.
- **Auto-issue** — when `customerShipping.requiresCertificateOfConformance`, the shipment
  post route issues revision 0 after a successful post, signed by the posting user;
  failures never fail the post (warning flash).

**Email** — an issued revision can be emailed, following the sales invoice pattern
(`renderAsync` a react-email template, signed URL of the stored PDF as the attachment,
`trigger("send-email", …)`):

- The issue dialog has "Email to customer" (on by default when a contact is resolvable),
  a customer-contact select and CC; each issued revision has **Send**.
- Default contact: the sales order's customer contact, else the customer's shipping
  contact (`customerShipping.shippingCustomerContactId`). A contact without an email is
  rejected with a message.
- `to` = [sender, contact], `from` = the sending user, subject `Certificate of Conformance
  {COC…-n} for {shipmentId} from {company}`, attachment = the stored PDF.
- Each send stamps `lastSentAt` / `lastSentTo`.
- Auto-issue also emails when the customer's shipping contact has an email; otherwise it
  issues without sending and says so. Email failure never fails the post or the issue.
- Template `packages/documents/src/email/CertificateOfConformanceEmail.tsx` + preview
  fixture.

**Customer portal: never.** `share+/customer.$id.*` pages are unauthenticated, so neither
certificates nor FAIRs are exposed there (user decision).

**Warnings (never block)** — the issue dialog lists: shipped items with an FAI due or
open, lots whose lineage reaches a receipt line with no certificate, outside-processing
operations with no certificate.

**Compliance statements** — company library (`complianceStatement`: name, content,
`appliesToAllCustomers`, active) with assignments to customers or items
(`complianceStatementAssignment`). A CofC prints the **union** of company-wide
statements, the customer's, and those of every shipped item, de-duplicated, in field 13.
Authored at Quality → Configure → Compliance Statements.

### 4. First Article Inspection = an inspection lot

**The lot.** A new `inspectionSourceDocument` value `'First Article'`:
`sourceDocumentId = job.id`, `sourceDocumentLineId = jobMakeMethod.id` (so the existing
partial unique index `(sourceDocument, sourceDocumentLineId)` makes generation
idempotent — one FAI lot per make method per job), `sourceDocumentReadableId = job.jobId`,
`itemId = jobMakeMethod.itemId` (each revision is its own item row), `lotSize = 1`.
The lot's readable `inspectionId` (INS…) **is** the FAIR Identifier (Form 1 field 4) — no
new sequence.

**Which parts need one — three switches, OR'd** (none of them is a per-part boolean;
`item.requiresInspection` was removed on 2026-07-26 in favour of "the assigned plan is
the gate", and this follows it):

1. **Company** — `companySettings.requireFirstArticle` ("Require first article for new
   parts and revisions", Quality settings, default off): every due part.
2. **Customer** — `customerShipping.requiresFirstArticle` ("Requires First Article", in a
   "Certifications" group beside "Requires Certificate of Conformance"): due parts on
   jobs whose `job.customerId` is that customer.
3. **Part** — the part (revision) has a plan assigned in the new **First Article** slot
   (`itemInspectionDocumentAssignment.usage = 'First Article'`, the same slot UI as
   Receipt).

**The plan — two rules, no chain:** the part's First Article slot; otherwise, if the part
(revision) has exactly one inspection plan (`inspectionDocument.partId = itemId`), that
one. Anything else — no plan, or several with none in the slot — is a **release
blocker** (below). So every generated FAI has its plan.

**Release blocker.** `getJobReleaseReadiness` gains
`firstArticlesWithoutPlan: { makeMethodId, itemId, description }[]` — make methods whose
part needs an FAI (switches + due) but resolves no plan. It is treated like
`missingAssemblies`: the job Release dialog and `BatchReleaseModal` list it and refuse
release (`production.server.ts` refusal messages ~:181-195), with a link to the part's
inspection plan slot ("Assign a first article plan for P-1001 Rev B"). The plain
`status=Ready` post in `$jobId.status.tsx` (:136-149) checks it too, so no release path
skips it. Nothing else about FAIs blocks anything — shipping and CofC issue only warn.

A plan's rows are ballooned or manual features alike — manual features (no balloon, or
plans with no PDF at all) are ordinary `inspectionFeature` rows and flow into Form 3
unchanged.

**Sampling.** For `First Article` lots every feature's resolved plan is
`{ type: "All", sampleSize: 1, acceptanceNumber: 0, rejectionNumber: 1 }` regardless of
the feature or document sampling rule (one override in the plan resolution of
`packages/database/src/quality.ts`). One unit, every characteristic — the Rev C
requirement, and it removes the "a sampled-out feature leaves Form 3 blank" gap.

**Running it.** Unchanged execution surfaces, because the engine and UIs are
source-generic:

- ERP: `/x/inspection/{id}` (`InspectionView` + `InspectionMeasurementGrid`), drawing pane
  beside the grid when the plan has a PDF.
- MES: a new route `apps/mes/app/routes/x+/first-article.$inspectionId.tsx` renders the
  existing MES `InspectionView` for a lot id, reusing the `inspection-lot.$id.*` action
  routes. Reached from a "First article required" banner on the operation view of every
  operation of that make method, and from the MES job page.
- Serial items: the inspector scans the first-article unit (existing `ScanInspectionSample`);
  it becomes the lot's single sample and Form 1 field 3.
- Readings carry optional **notes** (both grids gain a note affordance; the column and
  validators already exist) — Form 3 prints them after the result ("Applied",
  "Lab report LR-2231").
- Entity status is untouched: the engine only transitions tracked entities for `Receipt`
  lots (`quality.ts:305, 416, 823`).
- **Disposition** is verdict-only (like ERP job-operation lots): Accept / Reject (with the
  existing optional NCR) close the lot and lock its measurements through the existing
  hard-terminal guard. No production posting is attached.

**Generation (automatic).** `createFirstArticleInspections(db, { jobId, companyId,
userId, today })` in `packages/database/src/quality.ts`, beside
`getOrCreateJobOperationInspection`, sharing its plan resolution:

- For each `jobMakeMethod` of the job (root and made sub-assemblies — AS9102 needs an FAI
  per item), when one of the three switches applies, the item's FAI is **due** (§5), and
  the job has no FAI lot for that make method yet: insert the `inspection` (above, with
  the resolved plan), its sampling-plan rows, and the `firstArticleInspection` row with
  the seeded Form 1 header (scope Full; reason "New Part" or "Production Lapse" per §5).
  The same "needs an FAI" + plan resolution is shared with the readiness check through
  one function, `resolveFirstArticleNeeds`, so the blocker and the generator can never
  disagree.
- **Called at release** through one server function, `afterJobsReleased(db, client, …)`
  (`apps/erp/app/modules/quality/firstArticle.server.ts`), invoked at every release call
  site: `releaseJobs` (job Release dialog, batch and bulk release), the plain `status=Ready`
  post in `$jobId.status.tsx`, and the kanban auto-release block
  (`apps/erp/app/routes/api+/kanban.$id.tsx` ~:185, which writes `Ready` directly). Not
  inside `updateJobStatus` itself: it is a `*.service.ts` function, and service files may
  not build a Kysely client (`no-db-client-in-service`). Best-effort and logged — a
  generation failure never blocks a release. Known gap: the MES auto-start of a Draft job
  (`autoStartJobAndOperation`) skips release entirely, so it generates nothing.
- Release is the right moment: the make-method tree is final (recalculated by
  `releaseJobs`), it precedes any shop-floor work, and planned jobs that never release
  create nothing. Job creation is too early (MRP jobs have no method tree), first-piece
  completion too late.
- **Manual**: "New First Article" on the job page runs the same function for one chosen
  make method with a chosen scope (Full/Partial), reason, and baseline — for the Rev C
  triggers data can't detect (process, source, tooling, NC program, location change,
  corrective action).

**Form 1** (`firstArticleInspection`, 1:1 with the lot): seeded, editable text while
open — part number (customer part number when mapped, else ours), name, revision,
drawing number(s)/revision(s) (from the plan's `inspectionDocument`), additional changes
(released change notices of the item), manufacturing process reference (job + item),
organization, supplier code, customer PO; type (Assembly when the make method has made
children), scope, reason, baseline (a prior approved FAI, or free-text external
baseline), comments; signatures; optional customer approval. The **index** (fields 15–18)
is derived live: the make method's `jobMaterial` rows that are not raw materials, each
with the latest approved FAI of that item.

**Form 2** (`firstArticleInspectionProduct`): seeded from `getCertificationLineage` at
generation and on "Refresh from traceability" (adds new rows, never deletes user rows);
editable while open.

**Form 3**: derived live from the lot — one row per feature of its plan (sorted
numeric-aware by label; duplicate labels warned): characteristic number (label),
reference location, designator, requirement (nominal ± tolerances + unit + Ⓜ/Ⓛ, or the
feature description for non-measurement rows), results (value; "Accept"/"Reject" for
attribute rows; "Accept with MMC (bonus X, allowable Y; size #N)" when bonus was needed;
the reading's note appended), NCR number (the lot's `nonConformanceInspection` when the
row failed), tooling/comments = the reading's note.

**Lifecycle** (`firstArticleInspection.status`):

| Action | Allowed when | Effect |
|---|---|---|
| Generate / create | — | Draft |
| Edit Form 1 / Form 2 | Draft | — |
| Verify (fields 20/21) | Draft **and the lot is dispositioned** (Passed, Failed or Partial) | stores `hasNonconformance` (field 19: lot Failed/Partial, or any NCR linked to the lot or the make method's operations); verifier snapshot (name, title, time) |
| Reopen | Verified | back to Draft (the lot stays closed — measurements remain locked) |
| Approve (22/23) | Verified | approver snapshot; renders the FAIR PDF, stores it as a `document` (`sourceDocument = 'Job'`) and sets `documentId`; everything locked. Approver = verifier → confirm warning, allowed |
| Customer approval (24/25) | Approved | optional name + date — the only edit after approval |
| Delete | Draft and the lot has no measurements | deletes the extension and the lot |

An error found after the lot closes is a new FAI (Partial, baseline = this one) — Rev C
never alters an approved FAIR. The stored PDF is the record: later plan or data edits
can't change what was approved.

**PDF** — `file+/first-article+/$id[.]pdf.tsx`: the stored PDF once approved, a live
render (DRAFT overlay) before. Fixed layout, landscape, own `<Page>` (the shared
`Template.tsx` shell is untouched): Form 1, Form 2, Form 3 with continuation pages and
fields 1–4 repeated per form.

### 5. FAI-due rule (warn, never block)

`evaluateFirstArticleDue` (pure) and `getFirstArticleDue(client, companyId, { itemIds,
excludeJobId, today })`:

- **New Part** — no approved FAI (`firstArticleInspection.status = 'Approved'`) exists for
  the itemId (revision).
- **Production Lapse** — the item's most recent completed job (`job.completedDate`,
  status Completed/Closed, excluding the job being evaluated) is more than 2 years before
  today (company timezone, `@internationalized/date`), and no FAI was approved after it.

Used by generation (§4), the release blocker (only when a required FAI has no plan), the
ERP job header badge ("FAI due" / "FAI open", shown only when a switch applies), and the
CofC issue warnings. Shipping and CofC issue are never blocked (user decision).

### 6. Inspection plan extensions and bonus tolerance

New `inspectionFeature` columns, edited in the plan editor grid and persisted through
`save_inspection_document_atomic`: `designator` (free text, Form 3 field 7),
`referenceLocation` (sheet/zone, field 6), `materialCondition` (`RFS` default / `MMC` /
`LMC`), `sizeFeatureId` (the feature of size), `featureOfSize` (`Internal` hole /
`External` pin). `inspectionDocument.drawingRevision` (Form 1 field 7).

**Bonus** (pure `valuateGeometricMeasurement` beside `valuateMeasurement` in
`functions/shared/inspection-verdict.ts`, used by ERP and MES through
`@carbon/database/quality`):

```
sizeLower = nominal(size) − tolMinus(size); sizeUpper = nominal(size) + tolPlus(size)
MMC: bonus = Internal ? actualSize − sizeLower : sizeUpper − actualSize
LMC: bonus = Internal ? sizeUpper − actualSize : actualSize − sizeLower
bonus      = clamp(bonus, 0, sizeUpper − sizeLower)
allowable  = (nominal + tolPlus of the geometric feature) + bonus
status     = size reading Failed → Failed; size missing → bonus 0 (conservative);
             actual within [nominal − tolMinus, allowable] → Passed, else Failed
```

Datum shift is never computed. `inspectionMeasurement` gains `bonus` and `allowable`,
written at valuation time (extending the existing "valuation at entry" rule).
`upsertInspectionMeasurement` re-valuates dependent geometric readings on the same
sample when a size reading changes. Both grids show "allowable Y (bonus X)" under a cell
when bonus > 0.

### 7. Inspection-system fixes

1. **No silent result loss.** `save_inspection_document_atomic` refuses to delete a
   feature that has any `inspectionMeasurement`, raising `Feature "{label}" has recorded
   results and cannot be deleted` (the editor shows it). Features without results delete
   as before. Rationale: a recorded result is quality evidence; the cascade is kept as a
   backstop only for whole-company deletes.
2. **Inspection operations complete only through their inspection.** MES
   `end.$operationId.tsx` redirects an `Inspection` operation to its inspection view
   (`/x/inspection/{operationId}`) instead of posting quantity; `complete.tsx` rejects a
   POST for an `Inspection` operation with "Record this operation through its
   inspection". (The inspection view's own scrap/rework/finish escape hatches are
   unchanged, per the inspection-system rule.)
3. **Plans only on Inspection operations, enforced.** A migration nulls
   `inspectionDocumentId` on `methodOperation`, `quoteOperation` and `jobOperation` rows
   whose `operationType <> 'Inspection'` (they were never run — the MES ignores them), then
   adds `CHECK ("inspectionDocumentId" IS NULL OR "operationType" = 'Inspection')` to all
   three.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| FAI data model | An `inspection` lot (new source `First Article`) + a thin 1:1 `firstArticleInspection` extension + Form 2 rows | Reuses plans, sampling engine, measurement engine, ERP/MES execution UIs, NCR flow, terminal-lot locking, and the readable id; only Rev C–specific data is new (user: "use and modify the existing architecture") |
| FAIR identifier | The lot's `inspectionId` | Rev C only needs a unique identifier; avoids a parallel sequence |
| Which parts need an FAI | Company setting OR customer flag OR a First Article plan on the part | No per-part boolean (precedent: `requiresInspection` removed for the assignment gate); company/customer switches need zero per-part setup (user) |
| FAI plan | The part's First Article slot, else the part's only plan; otherwise a release blocker | User: "if there's only one plan, use that", "add a type for first article like receipt", no complex chain |
| Missing FAI plan | Release blocker in `getJobReleaseReadiness`, like `missingAssemblies` | User: follow the release-dialog blocker; guarantees every FAI has a plan |
| FAI sampling | Forced All, n = 1 | Rev C: every characteristic on one unit |
| Form 3 | Derived live from the lot; the approved PDF is the stored record | No copy table; the terminal-lot guard locks measurements; the stored PDF freezes the rest (same pattern as the CofC) |
| Feature deletes | Refused when results exist | Root-cause fix for silent loss of quality evidence on every lot, not just FAIs |
| FAI generation moment | Release (`updateJobStatus` → Ready, kanban auto-release) | Method tree final; before shop-floor work; unreleased planned jobs create nothing; the single choke point covers every release path |
| FAI generation scope | Every make method on the job (root + made sub-assemblies) whose item is due | AS9102: each item needs its own FAI |
| FAI disposition | Verdict-only | Like ERP job-operation lots; the FAI unit's production outcome belongs to the job's own operations |
| Verify precondition | Lot dispositioned | The verified evaluation must be final; closing the lot locks the measurements |
| Verifier = approver | Warn and allow | Rev C "should not"; a one-person quality shop must still finish |
| Readings with text | Optional note per reading, printed in Form 3 | Rev C results for notes/tests are statements or report numbers; the column exists |
| CofC layout | AS9163 14 fields, `certificateOfConformance` template type | IAQG template; customizable per company |
| CofC granularity / immutability | One per posted shipment; issued = stored PDF + row; reissue = new revision with reason | Lockheed QX; 9163 field 13; no drift |
| CofC delivery | Email (issue, Send, auto-issue); never the customer portal | User decisions; the portal is unauthenticated |
| Compliance statements | Library + assignments (all / customer / item), union | ProShop/Epicor per-customer/part verbiage as data |
| Signer | Any user reaching the action; snapshot name/title/time; "Document electronically generated and validated." | User decision; 9163 §5.4–5.7 |
| Certificate attach point | Receipt line or job operation (exactly one) | A receipt line groups the lots of one heat/cert; no per-lot duplication |
| Certificate file | `certificate.documentId` → `document` | Reuses upload/storage/backup path handling |
| Bonus | Feature bonus from the linked size reading; never datum shift; snapshot | Y14.5; conservative without size |
| Designator | Free text | Customer-defined per Rev C field 7 |
| FAI-due | Computed; warn on job + CofC; drives generation | User decision (warn) |
| Heuristic 1 — multi-tenancy | Every new table: `companyId`, composite PK, `id('prefix')` | `conventions-database.md` |
| Heuristic 2 — service shape | Services `client` first, `{data, error}`; transactional writes in `*.server.ts` / `@carbon/database/quality` with Kysely passed in | `no-db-client-in-service` |
| Heuristic 3 — RLS | Standard four policies; FAI tables + compliance statements `quality_*`; `certificate` `inventory_*` OR `quality_*`; `certificateOfConformance` `inventory_*` | Receiving attaches certs; quality owns FAIs |
| Heuristic 4 — permissions | Existing modules only | No RBAC change |
| Heuristic 5 — forms | `ValidatedForm` + zod in `*.models.ts` | `conventions-forms.md` |
| Heuristic 6 — module layout | No new module | One service + one models file per module |
| Heuristic 7 — backward compatibility | Additive enums/columns/tables; the CHECK migration first nulls plans that were never run; `save_inspection_document_atomic` gains optional keys and one refusal; completion guards only affect `Inspection` operations | Old backups restore; the refusal and guards are the intended behaviour change |

## Data Model Changes

One migration.

```sql
-- Enums (new)
CREATE TYPE "certificateType" AS ENUM ('Material', 'Special Process', 'Functional Test', 'Other');
CREATE TYPE "firstArticleInspectionStatus" AS ENUM ('Draft', 'Verified', 'Approved');
CREATE TYPE "firstArticleInspectionScope" AS ENUM ('Full', 'Partial');
CREATE TYPE "firstArticleInspectionType" AS ENUM ('Detail', 'Assembly');
CREATE TYPE "firstArticleInspectionReason" AS ENUM (
  'New Part', 'Design Change', 'Manufacturing Source Change', 'Process Change',
  'Inspection Method Change', 'Tooling Change', 'Material Change', 'Location Change',
  'NC Program Change', 'Natural or Man-made Event', 'Production Lapse',
  'Corrective Action', 'Other');
CREATE TYPE "customerApprovalVerification" AS ENUM ('Yes', 'No', 'N/A');
CREATE TYPE "materialCondition" AS ENUM ('RFS', 'MMC', 'LMC');
CREATE TYPE "featureOfSizeType" AS ENUM ('Internal', 'External');

-- Enums (extended)
ALTER TYPE "inspectionSourceDocument" ADD VALUE IF NOT EXISTS 'First Article';
ALTER TYPE "inspectionDocumentUsage" ADD VALUE IF NOT EXISTS 'First Article';

-- Plan / measurement extensions
ALTER TABLE "inspectionDocument" ADD COLUMN "drawingRevision" TEXT;
ALTER TABLE "inspectionFeature"
  ADD COLUMN "designator" TEXT, ADD COLUMN "referenceLocation" TEXT,
  ADD COLUMN "materialCondition" "materialCondition",
  ADD COLUMN "sizeFeatureId" TEXT REFERENCES "inspectionFeature"("id") ON DELETE SET NULL,
  ADD COLUMN "featureOfSize" "featureOfSizeType";
ALTER TABLE "inspectionMeasurement" ADD COLUMN "bonus" NUMERIC, ADD COLUMN "allowable" NUMERIC;
-- save_inspection_document_atomic: newest definition + 5 feature columns + refuse deleting measured features

-- Plans only on Inspection operations
UPDATE "methodOperation" SET "inspectionDocumentId" = NULL WHERE "operationType" <> 'Inspection' AND "inspectionDocumentId" IS NOT NULL;
-- (same for quoteOperation, jobOperation)
ALTER TABLE "methodOperation" ADD CONSTRAINT "methodOperation_inspectionDocument_type_check"
  CHECK ("inspectionDocumentId" IS NULL OR "operationType" = 'Inspection');
-- (same for quoteOperation, jobOperation)

-- Requirements
ALTER TABLE "customerShipping"
  ADD COLUMN "requiresCertificateOfConformance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requiresFirstArticle" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companySettings" ADD COLUMN "requireFirstArticle" BOOLEAN NOT NULL DEFAULT false;

-- certificate, complianceStatement, complianceStatementAssignment,
-- certificateOfConformance (with lastSentAt / lastSentTo): as in plan Task 1.

CREATE TABLE "firstArticleInspection" (
  "id" TEXT NOT NULL DEFAULT id('fai'),
  "companyId" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL UNIQUE REFERENCES "inspection"("id") ON DELETE CASCADE,
  "status" "firstArticleInspectionStatus" NOT NULL DEFAULT 'Draft',
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE RESTRICT,
  "jobId" TEXT NOT NULL REFERENCES "job"("id") ON DELETE RESTRICT,
  "jobMakeMethodId" TEXT NOT NULL REFERENCES "jobMakeMethod"("id") ON DELETE RESTRICT,
  "type" "firstArticleInspectionType" NOT NULL DEFAULT 'Detail',
  "scope" "firstArticleInspectionScope" NOT NULL DEFAULT 'Full',
  "reason" "firstArticleInspectionReason" NOT NULL DEFAULT 'New Part',
  "baselineFirstArticleInspectionId" TEXT,   -- self FK (id, companyId), SET NULL
  "baselineReference" TEXT,
  "partNumber" TEXT NOT NULL, "partName" TEXT NOT NULL, "partRevision" TEXT,
  "drawingNumber" TEXT, "drawingRevision" TEXT, "additionalChanges" TEXT,
  "manufacturingProcessReference" TEXT NOT NULL, "organizationName" TEXT NOT NULL,
  "supplierCode" TEXT, "purchaseOrderNumber" TEXT,
  "hasNonconformance" BOOLEAN, "comments" TEXT,
  "verifiedBy" TEXT REFERENCES "user"("id"), "verifiedByName" TEXT, "verifiedByTitle" TEXT, "verifiedAt" TIMESTAMPTZ,
  "approvedBy" TEXT REFERENCES "user"("id"), "approvedByName" TEXT, "approvedByTitle" TEXT, "approvedAt" TIMESTAMPTZ,
  "customerApprovalName" TEXT, "customerApprovalDate" DATE,
  "documentId" TEXT REFERENCES "document"("id") ON DELETE SET NULL,   -- approved PDF
  "customFields" JSONB,
  -- audit columns
  PRIMARY KEY ("id", "companyId")
);

CREATE TABLE "firstArticleInspectionProduct" (   -- Form 2 fields 5–13
  "id" TEXT NOT NULL DEFAULT id('faid'), "companyId" TEXT NOT NULL,
  "firstArticleInspectionId" TEXT NOT NULL,      -- FK (id, companyId) CASCADE
  "sortOrder" INTEGER NOT NULL DEFAULT 0, "kind" "certificateType" NOT NULL,
  "name" TEXT NOT NULL, "specification" TEXT, "code" TEXT, "supplier" TEXT,
  "customerApprovalVerification" "customerApprovalVerification" NOT NULL DEFAULT 'N/A',
  "certificateNumber" TEXT, "functionalTestProcedureNumber" TEXT,
  "acceptanceReportNumber" TEXT, "comments" TEXT,
  "certificateId" TEXT,                          -- FK (id, companyId) SET NULL
  -- audit columns
  PRIMARY KEY ("id", "companyId")
);

-- Sequence for existing companies (+ seed.data.ts for new ones): 'certificateOfConformance' / COC only.
```

Notes: `ALTER TYPE … ADD VALUE` cannot be used in the same transaction as a statement that
uses the new value — the migration must not reference `'First Article'` after adding it
(nothing in it does). No FKs are dropped; no table renamed (no `TABLE_RENAMES` entry).

## API / Service Changes

**`packages/database/src/quality.ts` (+ `functions/shared/inspection-verdict.ts`)**

- `valuateGeometricMeasurement` (pure, tested).
- `upsertInspectionMeasurement`: geometric valuation, `bonus`/`allowable`, dependent
  re-valuation; `notes` already accepted.
- Plan resolution: `First Article` lots force All / n = 1.
- `createFirstArticleInspections(db, { jobId, companyId, userId, today, only?: { jobMakeMethodId, scope, reason, baselineFirstArticleInspectionId?, baselineReference? } })`
  → `{ data: { inspectionIds: string[] }, error }`. Generates per §4 (plan resolution,
  lot + sampling rows + extension with seeded Form 1, FAI-due via a shared SQL-side read
  of approved FAIs and last completed jobs). Form 2 seeding is done by the ERP caller
  after the call (the lineage resolver uses supabase-js).

**`apps/erp/app/modules/production/production.service.ts`** — `updateJobStatus`: on the
real transition into `Ready`, call `createFirstArticleInspections` (best-effort, logged)
then seed Form 2 for the returned FAIs. Same in `api+/kanban.$id.tsx` auto-release.

**`apps/erp/app/modules/quality/`**

- Models: certificate, compliance statement, FAI header/product/customer-approval/manual
  create validators; enum consts; the `inspectionSourceDocument` filter options gain
  `First Article`; the item assignment `inspectionDocumentUsages` gains `First Article`.
- Service: certificates CRUD; `getCertificationLineage`; compliance statements CRUD +
  `getComplianceStatementsForShipment`; `getFirstArticleInspections` (list);
  `getFirstArticleInspection` (extension + lot + plan features + sample measurements +
  NCRs + derived index); `getFirstArticleInspectionsByJob`; `getFirstArticleDue`;
  Form 1/Form 2/customer-approval edits (Draft/Approved guards).
- Server (Kysely): `seedFirstArticleProducts`, `refreshFirstArticleProducts`,
  `verifyFirstArticleInspection`, `reopenFirstArticleInspection`,
  `approveFirstArticleInspection` (renders + stores the PDF),
  `deleteFirstArticleInspection`.
- Pure helpers (tested): `certificationLineage.ts`, `firstArticleDue.ts`,
  `firstArticleRows.ts` (Form 3 row derivation, requirement/results formatting, numeric
  sort, duplicate detection, index part types).

**`apps/erp/app/modules/inventory/`** — `getCertificatesOfConformance`,
`getCertificateOfConformanceData` (+ pure `buildConformityDetails`, tested);
`inventory.server.ts`: `renderCertificateOfConformancePdf`,
`issueCertificateOfConformance`, `sendCertificateOfConformance`.

**`packages/documents`** — `certificateOfConformance` template type (+ 2 blocks, meta,
default, catalog, merge fields), `CertificateOfConformancePDF` + samples + test,
`FirstArticleInspectionPDF` (fixed landscape) + samples + test,
`CertificateOfConformanceEmail` + preview fixture.

**MES** — `first-article.$inspectionId.tsx` (renders `InspectionView` for a lot id);
"First article required" banner on operation views + job page (loader reads open FAI lots
for the operation's make method); note affordance in `InspectionMeasurementMatrix`;
completion guards in `end.$operationId.tsx` and `complete.tsx`.

**Routes (ERP)** — CofC: preview/issued file routes, issue, send, post auto-issue;
receipt line certificates; compliance statements CRUD; FAI: `x+/quality+/first-articles.tsx`
(list), `x+/first-article+/new.tsx` (manual), `x+/first-article+/$id.tsx` (detail) with
`$id.header`, `$id.products`, `$id.products.$productId.delete`, `$id.refresh`,
`$id.certificates.new`, `$id.verify`, `$id.reopen`, `$id.approve`,
`$id.customer-approval`, `delete.$id`; `file+/first-article+/$id[.]pdf.tsx`.

## UI Changes

- **Shipment**: Certificate menu (Preview, Issue/Reissue, issued revisions with Download
  and Send); issue modal with warnings, reason, email toggle, contact, CC.
- **Customer → Shipping**: "Certifications" group — "Requires Certificate of Conformance",
  "Requires First Article".
- **Quality settings**: "Require first article for new parts and revisions".
- **Job Release dialog / batch release**: "Assign a first article plan for {part}" blocker
  with a link to the part's inspection plan slots.
- **Receipt lines**: "Certificates" drawer (list, add with upload, delete).
- **Item → inspection plan assignment**: the existing Receipt slot UI gains a "First
  Article" slot.
- **Plan editor grid**: Designator, Ref. location, Material condition, Size feature,
  Feature of size columns; Drawing revision; delete refusal message.
- **Measurement grids (ERP + MES)**: note per reading; "allowable Y (bonus X)".
- **Inspections list**: source filter gains "First Article" (free).
- **Quality → Inspection → First Articles**: list (FAIR id, part, revision, job, scope,
  lot status, FAI status, verified by, approved by).
- **FAI detail** (`/x/first-article/{id}`): header actions by status (Record results →
  opens `/x/inspection/{inspectionId}`, Verify, Reopen, Approve, Customer approval, PDF,
  Delete); Form 1 card (editable header, derived index, signatures); Form 2 table
  (edit/add/delete, refresh from traceability, attach certificate, missing-cert
  warnings); Form 3 table (read-only, derived).
- **Job header**: "FAI due" / "FAI open" badge; "First Article" menu listing the job's
  FAIs + "New First Article".
- **MES**: "First article required" banner with "Inspect" on operation views of the make
  method and on the job page; the first-article route; completion scan on an Inspection
  operation opens its inspection.
- **Quality → Configure → Compliance Statements**; **Settings → Templates** gains
  "Certificate of Conformance".

## Demo datasets (certificates)

All four datasets seed supplier certificates on Posted receipt lines (≥ 3 each):
`Material` where the received item is a material (precision, motor), `Other` (the
supplier's own CofC) for bought parts (satellite and robotics have no Posted raw-material
receipt lines). No dataset has a Posted Outside Processing receipt, so no Special Process
certificate is seeded. `ReceiptSpec.lines[].certificate`, inserted by tier 05; validator
(Posted + received, unique numbers, ≥ 3); `coverage.ts` floor `certificate: 3`. Exact
rows: plan. FAIs, CofCs and compliance statements are not seeded.

## Acceptance Criteria

CofC and certificates:

- [ ] A receipt line gets a certificate (Material, "HT-4471", "AMS 4027", PDF); it lists on
      the line and the PDF appears in the receipt's documents.
- [ ] `getCertificationLineage({ trackedEntityIds: [serial] })` for a serial built from a
      split child of that received lot returns "HT-4471"; a lot whose receipt line has no
      certificate yields a `missing: true` row (unit test over a fixture graph).
- [ ] An Outside Processing operation received with a Special Process certificate yields it;
      without one, a `missing: true` row naming the process and supplier.
- [ ] CofC preview on a Posted two-line shipment (two lots; three serials) renders fields
      1–14 numbered, lots/serials with quantities, and field 13 with the material cert, the
      approved FAI ids, and the union of three compliance statements (each once).
- [ ] Issue stores the PDF in the shipment's documents + a revision-0 row with signer
      snapshot; downloading returns the stored bytes after statements are edited.
- [ ] Reissue without a reason is refused; with one creates `COC…-1`, reason in field 13,
      revision 0 still downloadable. Issuing a Draft shipment is refused.
- [ ] Posting to a customer with "Requires Certificate of Conformance" issues revision 0 and
      emails it when the shipping contact has an email; without one it issues and says it
      did not email; failures never fail the post.
- [ ] Issue with "Email to customer" sends one `send-email` event with the stored PDF
      attached; Send re-sends the stored PDF; a contact without an email is refused;
      `lastSentAt`/`lastSentTo` update.
- [ ] `pnpm email:previews` shows the certificate email fixture.
- [ ] No route under `share+/` returns a certificate, an FAI, or their PDFs.

FAI:

- [ ] With all three switches off, releasing a job creates no FAI and shows no badge.
- [ ] With the company setting on, releasing a job whose item revision has no approved FAI
      creates exactly one `First Article` inspection per due make method (root + made
      sub-assembly), with the part's First Article plan (or its only plan), every feature
      at n = 1, and a Draft `firstArticleInspection` with seeded Form 1 and Form 2 rows.
      Releasing again (Paused → Ready) creates nothing new. A generation error does not
      block the release.
- [ ] With only the customer flag on, a job for that customer generates FAIs and a stock
      job (no customer) does not; with only a First Article plan assigned on a part, jobs
      for that part generate FAIs.
- [ ] A required, due part with no plan (or two plans and none in the First Article slot)
      blocks release in the job Release dialog, the plain Ready status post, and batch
      release, naming the part with a link to its plan slots; assigning the slot clears it.
- [ ] An item with an approved FAI and a completed job 3 months ago generates nothing; one
      whose last completed job was 25 months ago generates an FAI with reason "Production
      Lapse".
- [ ] Kanban auto-release generates FAIs the same way.
- [ ] "New First Article" on the job page creates a Partial FAI with a baseline for a chosen
      make method.
- [ ] A plan with manual (unballooned) rows and no PDF produces Form 3 rows for every row.
- [ ] In the MES, the operation view of the make method shows "First article required";
      "Inspect" opens the FAI lot; recording every feature (with a note on one) and
      accepting closes the lot; Form 3 then shows every result and the note.
- [ ] Verify is refused while the lot is open; after disposition it stores field 19 (true
      when the lot was rejected with an NCR) and the verifier snapshot.
- [ ] Approve by the verifier shows a warning and succeeds on confirm; the FAIR PDF is stored
      as a job document; every later edit except customer approval is refused.
- [ ] The FAIR PDF prints Forms 1–3 landscape with fields 1–4 repeated, continuation pages,
      DRAFT overlay until approved.
- [ ] The job header shows "FAI due" for a job of a new revision (before release) and
      "FAI open" once generated.

Bonus tolerance and notes:

- [ ] Position (nominal 0, +0.010, MMC, size = hole Ø.250 +.005/−0, Internal): size .254 +
      position .013 → Passed, bonus .004, allowable .014; size .250 → Failed; re-recording
      the size as .254 flips the position to Passed without re-entering it; no size reading →
      bonus 0; size out of tolerance → position Failed.
- [ ] Form 3 reads "Accept with MMC (bonus 0.004, allowable 0.014; size #N)" for that case.
- [ ] A note entered on a reading in the ERP grid and in the MES matrix is saved and shown.

Inspection-system fixes:

- [ ] Deleting a plan feature that has recorded results is refused with the feature named;
      deleting an unmeasured feature still works.
- [ ] Scanning the traveler "Complete" QR of an Inspection operation opens its inspection
      instead of posting quantity; a POST to `complete.tsx` for an Inspection operation is
      refused.
- [ ] After the migration, no `methodOperation`/`quoteOperation`/`jobOperation` row has a plan
      on a non-Inspection operation, and inserting one fails the CHECK.

Demo data and gates:

- [ ] Each demo dataset seeds ≥ 3 certificates on Posted receipt lines; `pnpm
      db:check:datasets` passes with the `certificate` floor.
- [ ] Unit tests: `valuateGeometricMeasurement`, lineage walk, `buildConformityDetails`,
      `evaluateFirstArticleDue`, Form 3 row derivation.
- [ ] Scoped typechecks (erp, mes, @carbon/documents, @carbon/database), Biome, package
      tests, `pnpm db:check:backups` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Generating FAIs on release adds work to every release | Low | One read of approved FAIs + completed jobs per release; best-effort, never blocks |
| Existing plans on non-Inspection operations are nulled by the CHECK migration | Low | They were never run (MES ignores them); count them in the migration's verification query and report the number in the PR |
| Refusing feature deletes frustrates plan edits | Med | Message names the feature; plan revisions are the path for obsolete characteristics; unmeasured features delete as before |
| `ALTER TYPE … ADD VALUE` transaction restriction | Low | The migration never uses the new values after adding them |
| Measuring the FAI unit twice (FAI lot + in-process lot) | Low | Matches practice (quality FAI vs operator checks); "copy readings" can follow |
| Lineage misses certs when consumption wasn't tracked | Med | `missing` rows; Form 2 is seed-then-edit; warnings name what's missing |
| Auto-issue emails a customer unexpectedly | Med | Only with the customer flag AND a shipping contact with an email; flag help text says so |
| `save_inspection_document_atomic` replacement drops behaviour | Med | Copy the newest definition verbatim; add only the new columns and the refusal |
| AS9163 Annex C per-field instructions unseen | Low | Field set from the IAQG template; layout customizable |
| Signer = anyone weakens 8.6 release-authority evidence | Low | User decision; identity + title snapshotted |

## Out of Scope (v1)

- SPC / Cpk / control charts.
- AS9102 Excel export, Net-Inspect push, QIF export, CMM import.
- Customer portal for CofCs/FAIRs — permanently excluded (unauthenticated).
- Emailing the FAIR; notifying a group when an FAI is generated (visible on the job,
  the Inspections list and the MES).
- FAIR package export; "copy readings from the unit's in-process inspections".
- Recording List/File/Person/Timestamp/Value readings natively (they record Pass/Fail +
  a note).
- Gauge per reading; Certificate of Analysis; a signing permission.
- Demo seeding of FAIs, CofCs, compliance statements.

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] **Procedure-step checks.** — **Answer (user, 2026-09-25):** go with the
      recommendation — keep them as work-instruction step records in this feature;
      plan-based Inspection operations are the in-process inspection path; converting step
      types is a possible follow-up spec.
      Original question: `Inspection` and `Measurement` procedure steps on Process
      operations, assembly-instruction steps, and NCR containment steps record to
      `jobOperationStepRecord` (a value or a boolean per unit index, no verdict, no NCR),
      never to `inspection*`, and the ERP Inspections list doesn't show them. Why it
      matters: plugging this means either routing those steps into the inspection engine
      (a much larger change to procedures, the MES step UI, and the ERP Steps tab) or
      leaving them as work-instruction checks. Recommendation: keep them as step records in
      this feature (they're work-instruction confirmations, not characteristic
      inspection), and make the plan-based path the only in-process inspection — fixes 2
      and 3 in §7 close the actual bypasses. Alternative: a follow-up spec that converts
      Measurement/Inspection step types into inspection features on an operation plan.

Human-resolved (user, 2026-09-25):

- [x] Signer — anyone for now.
- [x] FAI due — warn, never block.
- [x] Customer approval — captured, optional.
- [x] AS9163 fields — researched; 14-field template adopted.
- [x] Bonus tolerance — compute the feature's own bonus; never datum shift.
- [x] Form 2 — one `certificate` record, one lineage resolver, seed-then-edit.
- [x] Demo data — seed certificates.
- [x] CofC delivery — email (issue, Send, auto-issue with a shipping contact).
- [x] Customer portal — never (unauthenticated).
- [x] Architecture — build FAI on the existing inspection/inspection-plan architecture
      rather than parallel tables.
- [x] Manual plan rows — must flow into FAIs (they do: ordinary features).
- [x] In-process inspection gap — plug it (§7 fixes 2 and 3; procedure steps: open above).
- [x] FAI generation — needs a mechanism (§4: at release, plus manual).
- [x] Which parts need an FAI — three switches (company / customer / part plan), no
      per-part flag.
- [x] Which plan — the First Article slot (a usage type like Receipt), else the only plan;
      no complex chain; otherwise a release blocker.

Autonomous (review at the PR):

- [x] FAI identifier = the lot's `inspectionId`.
- [x] FAI sampling forced All, n = 1.
- [x] Form 3 derived live; approved PDF stored as the record.
- [x] Feature deletes refused when results exist (root fix for cascade loss).
- [x] Generation at release via `updateJobStatus` + kanban auto-release; best-effort.
- [x] FAI lots verdict-only; Verify requires a dispositioned lot.
- [x] Verifier = approver warns and allows.
- [x] Notes per reading as the text-result channel.
- [x] CofC issued record + stored PDF + revisions; `customerShipping` flag; compliance
      statement union; FAIR PDF fixed layout; existing permission modules only.

## Changelog

- 2026-09-25: Created (autonomous feature run).
- 2026-09-25: Spec review — CofC email; certificates in demo data; portal excluded.
- 2026-09-25: v2 — FAI rebuilt as an inspection lot (source `First Article`) with a thin
  extension instead of parallel tables (dropped the Form 1 index and Form 3 tables and the
  FAI sequence); FAI generation at release; notes per reading; inspection-system fixes
  (no result loss on feature delete, Inspection-operation completion guards, plans only
  on Inspection operations). One open question: procedure-step checks.
- 2026-09-25: Procedure steps stay step records (user). FAI requirement = company setting
  OR customer flag OR a First Article plan on the part; plan = First Article slot else the
  part's only plan; unresolved plan = release blocker (`getJobReleaseReadiness`). All
  questions resolved; ready for planning.
- 2026-09-26: Implemented (19+ commits on highest-value-feature-ideas branch). Post-review
  fixes: firstArticleInspection job/make-method FKs are ON DELETE SET NULL; an open FAI for
  the item on another job satisfies the need; Draft/Planned → In Progress counts as a
  release; CofC auto-send requires the email integration; lineage uses the descendants RPC.
