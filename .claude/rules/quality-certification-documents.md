---
paths:
  - "apps/erp/app/modules/quality/certificationLineage.ts"
  - "apps/erp/app/modules/quality/firstArticleRows.ts"
  - "apps/erp/app/modules/quality/firstArticle.server.ts"
  - "apps/erp/app/modules/quality/firstArticlePdf.server.tsx"
  - "apps/erp/app/modules/inventory/certificateOfConformance.ts"
  - "apps/erp/app/modules/inventory/inventory.server.tsx"
  - "apps/erp/app/routes/x+/first-article+/**"
  - "apps/erp/app/routes/x+/shipment+/$shipmentId.certificate*.tsx"
  - "packages/database/src/first-article.ts"
  - "packages/documents/src/pdf/CertificateOfConformancePDF.tsx"
  - "packages/documents/src/pdf/FirstArticleInspectionPDF.tsx"
  - "packages/documents/src/pdf/blocks/certificateOfConformance/**"
  - "apps/mes/app/routes/x+/first-article.$inspectionId.tsx"
---

# Quality Certification Documents — CofC (AS9163) and First Article (AS9102)

Two outbound quality records built on one input: the **certification lineage**
(which supplier certificates stand behind a part). Schema is one migration,
`20260926032544_cofc-fai-reports.sql`; spec
`.ai/specs/2026-09-25-cofc-fai-reports.md`.

## Certificates and where they attach

`certificate` (`cert` id, composite PK) is a supplier certificate: `type`
(`certificateType`: Material / Special Process / Functional Test / Other),
`certificateNumber`, `specification`, `supplierId`, optional `documentId` (the
uploaded file) and exactly one target — CHECK `certificate_one_target`
(`num_nonnulls("receiptLineId", "jobOperationId") = 1`):

- **Receipt line** — `x+/receipt+/lines.$lineId.certificates.tsx`, opened from
  `ReceiptLines.tsx` (`CertificatesDrawer`). Permission per intent: loader
  `inventory_view`, add `inventory_create`, `intent=delete` `inventory_delete`.
  The writes are `addReceiptLineCertificate` / `deleteReceiptLineCertificate`
  (`quality/certificates.server.ts`): the `document` and `certificate` rows go
  in ONE Kysely transaction (the browser-uploaded file is removed on failure,
  unless another `document` already points at that path); a form `supplierId`
  that is not the company's is dropped; delete is scoped to the line and fails
  when it removed nothing.

  **Regenerating a receipt keeps its certificates.** The `create` server function
  rebuilds every line of an existing receipt when its source document or
  location changes (`receiptFromPurchaseOrder`, `receiptFromInboundTransfer`,
  `receiptFromSalesReturnOrder`), and `receiptLineId` is ON DELETE CASCADE. The
  rebuild goes through `replaceReceiptLines` (`packages/server-functions/src/create/index.ts`): in
  the same transaction it reads the receipt's certificates, inserts the new
  lines, MOVES each certificate (one `UPDATE … CASE "id"`, so it keeps its id)
  to the new line with the same `receiptLine.lineId` — or the same `itemId`
  when the old line had no `lineId` — and only then deletes the old lines. An
  UPDATE rather than re-insert because Form 2 rows point at the certificate
  (`firstArticleInspectionProduct.certificateId`, ON DELETE SET NULL) and a
  Draft outside-processing receipt's certificates are already on Form 2. A
  certificate whose source line is not on the rebuilt receipt (the receipt was
  re-sourced to another document) has no valid target under
  `certificate_one_target`; it is deleted with its old line and logged as a
  warning with the certificate ids and numbers. The response carries no count.
- **Job operation** — `x+/first-article+/$id.certificates.new.tsx` ("Attach
  certificate" on FAI Form 2; `quality` create+update, Draft FAI only). The
  operation id comes from the client, so the route re-checks it belongs to the
  FAI's make method, then runs `refreshFirstArticleProducts`.

RLS lives in the authz manifest (`packages/database/src/authz/manifest.ts`,
shipped by the generated `20260928012744_cofc-fai-rls.sql`), not in the feature
migration: `certificate` accepts `inventory_*` OR `quality_*`;
`certificateOfConformance` is `inventory_*` (shipments are inventory) and its
INSERT takes `inventory_update` — issuing is an update of the posted shipment;
the compliance and FAI tables are `quality_*`.

`complianceStatement` (+ `complianceStatementAssignment`, one of `customerId` /
`itemId`) holds the boilerplate a certificate prints. `upsertComplianceStatement`
(Kysely) keeps only the form's customer / item ids that belong to the company
before writing the assignments. A statement applies when
`appliesToAllCustomers` or it is assigned to the shipment's customer or to any
shipped item (`getComplianceStatementsForShipment`). Managed at
`x+/quality+/compliance-statements*.tsx`.

## The lineage walk (`getCertificationLineage`, quality.service.ts)

Pure half in `certificationLineage.ts` (`findReceivedRoots`, `dedupeLineageRows`,
unit-tested); the service injects the one query.

Input is either `{ trackedEntityIds }` (CofC: the shipped lots) or
`{ jobId, jobMakeMethodId?, trackedEntityId? }` (FAI Form 2). With a
`jobMakeMethodId` the start entities are that make method's own consumption —
the inputs of the `Consume` activities the issue path tags with
`attributes->>Job Make Method` — so a sub-assembly's Form 2 never lists another
make method's materials (`itemLedger` cannot narrow it: the tracked-material
ledger rows carry no `documentLineId`). Without one, every `itemLedger`
`Job Consumption` row of the job.

- **Materials** — breadth-first back through lineage until a branch reaches an
  entity with a `Receipt Line` attribute (written by post-receipt); that entity
  is a root and the walk stops there. Visited set for cycles, `maxDepth = 12`.
  Each root's receipt line yields its certificates, or one `missing: true` row.
- **Job only** — each Outside Processing operation yields the certificates on
  the receipt lines of its PO lines (outside-processing receipts write no
  tracked entities, so this goes through `purchaseOrderLine.jobOperationId`),
  or a `missing` Special Process row when there are none and none is attached to
  the operation; every operation's own certificates; and a `missing` Material row
  per untracked (not Batch/Serial) Material the make method consumes.
- A certificate's own `supplierId` wins over the receipt's / PO's.
- `dedupeLineageRows`: one row per certificate; `missing` rows collapse per
  receipt line, else job operation, else name.

**Direction gotcha.** The walk calls
`get_direct_descendants_of_tracked_entities_strict`, and that is correct: Carbon
names lineage from the assembly DOWN. The "descendants" RPC joins
`trackedActivityOutput` on the seed and returns that activity's **inputs** — the
lots a part was made from (or split from). `get_direct_ancestors_of_...` goes the
other way: activities that CONSUMED the seed, returning their outputs. Both are
in `20260430090114_lineage-batch-rpcs.sql`. Calling "ancestors" to answer "what
did this part consume" walks forward into the shipment and finds nothing. See
`traceability-model.md` → How lineage is queried.

`missing` rows are deliberate output, not errors: the CofC's issue dialog lists
them as warnings, and FAI Form 2 seeds them with the comment
`No certificate on file`.

## Certificate of Conformance (AS9163)

Record: `certificateOfConformance` (`coc` id) — `certificateId` (the `COC`
sequence number, seeded for existing companies by the migration and in
`packages/database/src/seed-data.ts`), `revision`, `shipmentId`, `customerId`,
`reasonForUpdate` (CHECK: required when `revision > 0`), `documentId`, the
signature snapshot (`signedBy/Name/Title/At`), `lastSentAt` / `lastSentTo`.
UNIQUE `(companyId, certificateId, revision)`. Printed number is
`withRevisionSuffix(certificateId, revision)` — `COC000123`, then `COC000123-1`.

Server code is `inventory.server.tsx`; data load is
`getCertificateOfConformanceData` (inventory.service.ts); field 13 is the pure
`buildConformityDetails` (`certificateOfConformance.ts`: shelf life, latest
approved FAIR per item, material vs process certificates, `Use As Is`
nonconformances as concessions, statements, reason for update).

| Step | Where | Behavior |
|---|---|---|
| Preview | `file+/shipment+/$id.certificate[.]pdf.tsx` | Live render, PREVIEW watermark, current user as would-be signer |
| Issue / Reissue | `x+/shipment+/$shipmentId.certificate.tsx` → `issueCertificateOfConformance` | Posted shipments only. One Kysely txn: `FOR UPDATE` on the shipment (two clicks cannot mint two numbers), sequence (rev 0) or latest+1 (reissue — throws without a reason), render, upload, `document` row, `certificateOfConformance` row. An uploaded object is removed if anything after it fails |
| Download | `file+/shipment+/$id.certificate.$revision[.]pdf.tsx` → `getIssuedCertificateOfConformancePdf` | The **stored** PDF, never re-rendered. The `document` row's read groups are the issuer's, so its path is read with the service role after the caller's client proved it can see the certificate |
| Send | `$shipmentId.certificate.$certificateId.send.tsx` → `sendCertificateOfConformance` | Emails the stored PDF (signed URL attachment via `send-email`) to a contact of the certificate's customer, plus the sender; stamps `lastSentAt/To` |
| Auto-issue | `autoIssueCertificatesOfConformance` (inventory.server.tsx), from the shipment post route and the sales invoice post route (below) | After a post that stuck, when `customerShipping.requiresCertificateOfConformance`: issue revision 0, then email the customer's shipping contact when the email integration is active. Skips a shipment that already has revision 0, so it never reissues. **Never fails the post** — every failure becomes part of the flash |

The PDF is template-driven: document type `certificateOfConformance`
(`CertificateOfConformancePDF.tsx`, registry
`pdf/blocks/certificateOfConformance/`), see `document-template-customizer.md`.

Auto-issue has two call sites, both after the post has committed:

- `x+/shipment+/$shipmentId.post.tsx` — the one shipment, with the user's
  client. The outcome shares one flash with the expired-batch warning; a
  failed issue turns it into an error flash, the post still stands.
- `x+/sales-invoice+/$invoiceId.post.tsx` — `post-sales-invoice` inserts one
  `shipment` per location for invoice lines no shipment covered, already
  `Posted`, with `sourceDocument = 'Sales Invoice'` and `sourceDocumentId` =
  the invoice (its void reads them back by the same key). The route reads those
  (status Posted, `companyId`-scoped) with the **service role** — like the rest
  of that route after the post, since the caller holds `invoicing`, not
  necessarily `inventory` — and issues right after the post, before the PDF and
  the invoice email, so their early returns cannot skip it. The route returns
  `{ success, message }` rather than a flash: the outcome is appended to
  whatever it returns, and `certificateFailed` makes `SalesInvoicePostModal`
  toast it as an error while still closing. The invoice email is independent.
  The certificate's customer and PO come from the Sales Invoice
  (`getCertificateOfConformanceData`'s `Sales Invoice` branch). A sales
  invoice has no ship-to (its `locationId` is our warehouse, its
  `invoiceCustomerLocationId` the bill-to), so field 6 prints the ship-to of
  the ONE sales order its lines were invoiced from (`invoiceShipToSalesOrderId`)
  and is left blank for a standalone or mixed-order invoice — never the bill-to.
  Both sources resolve the order's ship-to with `salesOrderShipToLocationId`
  (`certificateOfConformance.ts`): a drop shipment prints the order shipment's
  location, never the header's, the rule `resolveSalesOrderShipTo` applies.
  A shipment the invoice merely references (`salesInvoice.shipmentId`) was
  posted — and certified — by the shipment post route.

Not covered:

- **Customer portal: never.** No `share+/` route exposes certificates or FAIRs.
  Per the spec, `share+/customer.$id.*` pages are unauthenticated.

## First Article Inspection (AS9102)

An FAI is an **inspection lot** with `sourceDocument = 'First Article'`
(`sourceDocumentId = job.id`, `sourceDocumentLineId = jobMakeMethodId`), plus a
1:1 extension row `firstArticleInspection` (`fai` id, UNIQUE `inspectionId`,
ON DELETE CASCADE from the lot) holding Form 1 (part, drawing, reason, scope,
type, baseline) and the verify/approve signatures. `firstArticleInspectionProduct`
(`faid`) is Form 2; Form 3 is derived from the lot's plan features and readings
by the pure `buildForm3Rows` (`firstArticleRows.ts`), shared by the detail page
and the PDF. The lot's readable `inspectionId` is the FAIR identifier.

### Which parts need one — `resolveFirstArticleNeeds`

`packages/database/src/first-article.ts` (`@carbon/database/first-article`,
pure, tested). One function answers for three callers, so they cannot disagree:

1. the **release blocker** — `getJobReleaseReadiness` → `firstArticlesWithoutPlan`
   (production.service.ts, inputs loaded over supabase-js),
2. the **generator** — `createFirstArticleInspections`
   (`@carbon/database/quality`, inputs from `loadFirstArticleNeedInput`, Kysely),
3. the **job header "FAI due" chip** — `getFirstArticlesDueForJob`
   (firstArticle.server.ts).

Per job make method (root and made sub-assemblies alike):

- **Required** when any of the three switches applies:
  `companySettings.requireFirstArticle` (Settings → Quality,
  `updateRequireFirstArticleSetting`), the job customer's
  `customerShipping.requiresFirstArticle`, or the part has a **First Article
  plan slot** (`itemInspectionDocumentAssignment` usage `'First Article'`, item
  Quality tab).
- **Due** (`evaluateFirstArticleDue`): `New Part` when the item has no Approved
  FAI; `Production Lapse` when the item's last completed job (other jobs only)
  is more than 2 years before today and no FAI was approved after it. "Last
  completed job" is read through `jobMakeMethod.itemId`, not `job.itemId`, so a
  sub-assembly built inside parent jobs has a production history too.
- **Plan**: the First Article slot, else the part's **only** plan
  (`inspectionDocument.partId = itemId`, exactly one). Two plans and no slot
  resolves nothing.
- **Open elsewhere**: an open (Draft / Verified) FAI for the same item on
  ANOTHER job (`jobId` set and different) satisfies the need — the part's first
  article is already in progress. Input `hasOpenFirstArticleElsewhere`, loaded
  by both loaders (`loadFirstArticleContext` in Kysely,
  `getFirstArticlesWithoutPlan` over supabase-js — the latter pages approvals,
  open FAIs and completed jobs with `fetchAllFromTable`, so PostgREST's
  1000-row cap cannot drop rows). An FAI whose job was deleted does not count.
- `pending` = required ∧ due ∧ no lot on this job ∧ none open elsewhere — the
  job header's "FAI due" chip.
  `blocked` = pending ∧ no plan → **release blocker**
  ("Assign a first article plan for P-1001 Rev B").
  `create` = pending ∧ a plan → the generator creates the lot.

### Generation at release — `afterJobsReleased`

`firstArticle.server.ts`. Called after the Ready write succeeds, on every path
that releases a job:

- `releaseJobs` (production.server.ts) — the job Release dialog and batch
  release (`releaseBatchMemberJobs`, from `production+/batches.release.tsx` and
  `priority+/batching.update.tsx`; batch release refuses the whole batch naming
  each job's parts without a plan);
- a plain status post in `x+/job+/$jobId.status.tsx` that is a **release**:
  prior status Draft or Planned and new status `Ready` **or `In Progress`**
  (both run the blocker, then generation). **Ready from Paused is a resume**:
  no readiness re-check, no generation. The Release dialog branch
  (`status=Ready&schedule=1`) requires the same Draft/Planned prior status and
  refuses otherwise ("Only a Draft or Planned job can be released"), so an
  already-released job is never put through `releaseJobs` again;
- kanban auto-release (`api+/kanban.$id.tsx`) — generates, but is **not gated**
  by the blocker (it never reads readiness).

**MES auto-start is a release too.** `autoStartJobAndOperation`
(`apps/mes/app/services/operations.service.ts`, from `startProductionEvent`)
moves the job to In Progress when an operator starts a production event. It
writes Draft/Planned → In Progress and Ready → In Progress as two guarded
updates; a row back from the first (`.in("status", ["Draft", "Planned"])
.select("id")`) is the proof THIS start released the job, and only then does
it call the route's `onJobReleased` callback — Ready → In Progress is an
ordinary start, generated at its release already. The callback is
`generateFirstArticlesForStartedJob` (`apps/mes/app/services/quality.server.ts`;
`operations.service.ts` is browser-bundled and cannot hold the Kysely client),
passed by `x+/event.tsx` and `x+/start.$operationId.tsx`: the same
`createFirstArticleInspections` with the company-timezone today, best-effort
(logged, never fails the start). It does **not** run the blocker — the
operator is already working. A part with no plan instead shows a
"First article plan missing for {part}" banner on the MES job page and on the
operation view of its make method (`getFirstArticlePlansMissingForJob`:
`loadFirstArticleNeedInput` + `resolveFirstArticleNeeds` → `blocked`). It also
does not seed Form 2 — the lineage resolver lives in the ERP; see the lazy seed
below. (The MES floor rule only lets an operator start an unbatched operation
of a released job, so in practice this is a batched member whose batch was
released while its job was still Draft/Planned.)

Not inside `updateJobStatus`: a `*.service.ts` may not hold a Kysely client.
Best-effort: a failure is logged and never undoes a release; a missed lot can be
created by hand at `x+/first-article+/new.tsx` (`only` request: treated as
required and due, still needs a plan, refused when the make method already has
a lot).

`createFirstArticleInspections` runs in one transaction: lot with `lotSize = 1`,
plan `All`, per-feature `inspectionSamplingPlan` rows at n = 1 (see
`inspection-system.md`), and the extension seeded from the job — customer part
number/revision when a `customerPartToItem` exists, else the item's
(`N/C` when neither has a revision), drawing number/revision from the plan,
released change orders as additional changes, the sales order's customer
reference as PO, `Assembly` when the make method has a Make to Order child.
Idempotent: the lot insert is `ON CONFLICT (sourceDocument,
sourceDocumentLineId) DO NOTHING`. Form 2 is then seeded from the lineage by
`seedFirstArticleProducts` — the refresh below, but a no-op once the FAI has
any Form 2 row (re-checked under the FAI's `FOR UPDATE` lock, so two
concurrent seeds cannot both insert).

**Lazy Form 2 seed.** An MES-generated FAI has no Form 2 rows. The ERP detail
loader (`x+/first-article+/$id.tsx`) calls `seedFirstArticleProductsOnView`
when the FAI is Draft, still has its job and make method, and has zero product
rows, then reloads the detail if anything was inserted. It is a GET that
writes, so it is skipped on a cross-site navigation (`isCrossSiteNavigation`
from `@carbon/auth/middleware/security.server`) — the page still renders,
unseeded, rather than refusing a link from an email. Best-effort (logged;
the page loads without rows and Refresh still works). Consequence: a user who
deletes EVERY Form 2 row of a Draft FAI gets them re-seeded on the next view.

`refreshFirstArticleProducts` ("Refresh from traceability", Draft only) inserts
lineage rows not already present, matched by `certificateId`, or by
`kind + name` for a missing one. It **never deletes or rewrites** a row — rows
may carry the user's edits.

### Lifecycle — `firstArticleInspectionStatus`

| From → To | Function | Guard / effect |
|---|---|---|
| (created) Draft | generator / manual | Header, Form 2 editable (`updateFirstArticleInspectionHeader`; `upsert/deleteFirstArticleInspectionProduct` in firstArticle.server.ts lock the FAI row `FOR UPDATE` and re-check Draft in the same Kysely transaction as the write) |
| Draft → Verified | `verifyFirstArticleInspection` | Lot must be dispositioned (Passed/Failed/Partial). Snapshots `hasNonconformance` = lot Failed/Partial, or an NCR linked to the lot or to an operation of the make method. Signs fields 19–21 |
| Verified → Draft | `reopenFirstArticleInspection` | Clears verification. The lot stays closed; readings stay locked |
| Verified → Approved | `approveFirstArticleInspection` | Renders the FAIR (landscape A4) with the approver's signature — the render reads the FAI under the caller's client and company, which is the access proof — then uploads it with the **service role** under `{companyId}/job/{jobId}/` (or `{companyId}/first-article/{id}/` when the job was deleted), then in one txn inserts a `document` (source `Job`, or none without a job) and locks the FAI. Upload removed (service role) on failure. When the approver is the verifier the UI asks for confirmation (`FirstArticleHeader`); the server does not refuse |
| Approved | `updateFirstArticleCustomerApproval` | The only edit an Approved FAI accepts: fields 24/25 |
| Draft (no readings) → deleted | `deleteFirstArticleInspection` | Deletes the lot; extension, Form 2, plans, samples cascade |

**The approved PDF is the record.** `file+/first-article+/$id[.]pdf.tsx` serves
the stored document for an Approved FAI and renders live (DRAFT mark) otherwise,
so later plan or data edits never change what was approved. The stored
`document` row is readable only by the approver (`readGroups`), so after the
FAI read under the caller's client proves access, the document path and the
file are read with the service role — the CofC download does the same.

### When the job or make method is gone

`firstArticleInspection.jobId` and `jobMakeMethodId` are nullable,
`ON DELETE SET NULL` (migration `20260926053908_first-article-fk-set-null.sql`):
the report is a quality record that outlives its job, and RESTRICT blocked job
deletion and Get Method's sub-assembly rebuild (which deletes and re-inserts
`jobMakeMethod`). The FAI keeps its own part snapshot. With either link null:

- the detail page shows a "Job deleted" / "Make method removed" badge, the
  Form 1 index says it cannot be derived, and Refresh / Attach Certificate are
  disabled (`getFirstArticleInspection` skips the materials / operations reads);
- `verifyFirstArticleInspection`, `seed/refreshFirstArticleProducts` and
  `$id.certificates.new.tsx` refuse with "The job or make method of this first
  article no longer exists";
- approve and the PDF still work (above).

### Recording the verdict

- **ERP** — `x+/inspection+/$id.accept.tsx` / `$id.reject.tsx` accept a First
  Article lot (`requireSource: "First Article"`, `requireOpen: true`): verdict
  only, **one-shot** (Verify snapshots the verdict), and the redirect goes back
  to the FAI. Reject never looks up received entities for it (its line id is a
  make method) and can raise an NCR.
- **MES** — `apps/mes/app/routes/x+/first-article.$inspectionId.tsx`: the shared
  `InspectionView` in a verdict-only mode (Accept / Reject, no Partial — the lot
  has one unit), one-shot `dispositionInspection({ requireOpen: true })`, 404 for
  anything that is not this company's First Article lot. Reject's NCR is raised
  against the make method's first operation. The MES job and operation pages
  show a "First article required" banner (`getOpenFirstArticleInspectionsForJob`)
  with an Inspect button, and a "First article plan missing" banner for a part
  that needs one but resolves no plan (above).

## Known gaps

- **Attaching a certificate does not retire the old `No certificate on file`
  Form 2 row.** Refresh keys a real certificate by `certificateId` and a
  missing one by `kind + name`, so it adds the new row beside the old one; the
  user deletes the stale row by hand.
- The demo datasets seed supplier certificates (tier 05) but never a First
  Article lot — the dataset validator excepts that source because only the
  release path creates one.
