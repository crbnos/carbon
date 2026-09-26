# Certificate of Conformance + AS9102 First Article Inspection Research: Best Practices Survey

## Summary

Surveyed how SAP S/4HANA QM, the FAI point solutions (1factory, High QA, Net-Inspect,
DISCUS, InspectionXpert/Ideagen), and job-shop ERPs (ProShop, Epicor Kinetic, E2,
JobBOSS², NetSuite, Fulcrum) produce **Certificates of Conformance (CofC)** and **AS9102
Rev C First Article Inspection Reports (FAIR)**, plus what the standard and the primes'
quality clauses (Lockheed QX, Northrop Q-clauses, Leonardo DRS, Ducommun, FAR
52.246-15, DFARS) actually require. Key findings: (1) every FAI tool is keyed on the
**balloon / characteristic number** — drawing → "Bill of Characteristics" → results →
Form 3 row — which Carbon already has (`inspectionFeature` + `inspectionMeasurement`);
(2) Form 2 (materials, special processes, tests) is **typed by hand in every point
solution** — only an ERP with lot traceability can auto-fill it, which is Carbon's
structural advantage; (3) SAP does not produce AS9102 forms and has no in-house FAI at
all — its FAI is procurement-only; (4) CofC is weakly served by most ERPs (Epicor: "no
two companies do CofCs the same way"; custom report work) and best served by ProShop
(shipment-based CofC, partials allowed, one-button package of CofC + FAIR + certs +
ballooned drawing); (5) the CofC field set is highly consistent across primes: one per
shipment, PO + line, part + revision, qty, lot/serial per line, positive unqualified
conformance statement, authorized signer name/title/date, e-signature accepted.

## Competitors Surveyed

- **SAP S/4HANA QM** — enterprise reference for outgoing quality certificates
  (certificate profile, result origins, delivery-item output) and procurement FAI.
- **1factory** — FAI + ballooning + control plan; strongest "FAI plan becomes the
  production plan" and revision-compare story.
- **High QA (Inspection Manager)** — Bill of Characteristics, Form 1/2/3 templates,
  report designer, ProShop integration.
- **Net-Inspect** — the portal Airbus/Northrop/Boeing mandate; de facto digital FAIR
  exchange; best-documented FAI lifecycle (delta FAI, buy-off statuses).
- **DISCUS** — drawing analysis → BoC, CMM import, FAIR packaging, QIF export.
- **InspectionXpert / Ideagen QC** — ballooning → AS9102 Excel template, CMM parsers,
  Net-Inspect upload.
- **ProShop ERP** — closest analogue to Carbon: ERP-native FAI on the work order +
  shipment-based CofC + cert package.
- **Epicor Kinetic, E2, JobBOSS², NetSuite, Fulcrum** — how mainstream ERPs (fail to)
  model CofC.
- **Standards / primes** — IAQG 9102 Rev C forms, AS9100D 8.5.2/8.6, AS9163 (CoC
  standard), FAR 52.246-15, DFARS 252.225-7009 / 252.246-7007/-7008, Lockheed QX,
  Northrop SQC-34/Q31500, Leonardo DRS SCM-004, Ducommun 38-4000.

## Key Consensus Patterns

### 1. The characteristic (balloon) number is the join key for everything FAI

- **SAP**: no ballooning; certificate characteristics come from master inspection
  characteristics on inspection lots.
- **1factory / High QA / DISCUS / InspectionXpert**: balloon → "Bill of Characteristics"
  row → inspection plan → result; CMM output is programmed to balloon numbers so results
  "download right onto the First Article form".
- **Net-Inspect**: Form 3 rows keyed by Bubble #; imports BoCs from ballooning tools.
- **AS9102 Rev C Form 3 field 5**: unique char no. per design characteristic,
  traceable to the balloon and to any automated/CMM report.
- **Rationale**: Form 3 is literally one row per balloon; auditors trace
  drawing ↔ report ↔ CMM printout by that number.

### 2. Characteristics carry more than nominal ± tolerance

- **All FAI tools**: designator (Key / Critical / Major), reference location
  (sheet/zone), requirement text (notes are characteristics too), attribute vs
  variable, inspection method / gauge, operation.
- **AS9102 Rev C Form 3**: fields 6 (reference location), 7 (designator), 8
  (requirement), 9 (results — values, or pass/fail + statement for attributes, or
  "Accepted/Applied" for notes), 10 (designed/qualified tooling — gauge ID), 11 (NCR
  number).
- **Rationale**: the standard requires every design characteristic, including notes,
  flag notes and title-block/spec callouts, not just dimensions.

### 3. FAI is a header record wrapping inspection results, with a sign-off lifecycle

- **Net-Inspect**: FAIR = Form 1 + Form 2 + Form 3 + Documents + Workflow + Checklist;
  statuses In-Work → Complete / Not Complete → Submitted → Pending Buy-off → Approved /
  Approved Conditionally / Disapproved; approval locks the record.
- **High QA**: digital multi-role approval, versioned plans.
- **ProShop**: FAI form lives on the work order's first part; auto-fills from ERP data.
- **AS9102 Rev C Form 1**: field 19 "Does FAIR contain a documented nonconformance?",
  field 20 Verified By + 21 date, field 22 Reviewed/Approved By (should differ from
  20) + 23 date, 24/25 customer approval, electronic signatures acceptable.
- **Rationale**: the FAIR is an auditable, signed, immutable record; an FAI with an
  open nonconformance is "not complete" and needs a partial FAI after corrective action.

### 4. Partial (delta) FAI = copy a baseline and re-inspect only what changed

- **Net-Inspect**: "Copy from Existing" with a Delta flag keeps a parent–child link.
- **1factory**: revision compare highlights added/removed/changed characteristics;
  "only inspect what changed".
- **AS9102 Rev C**: Form 1 field 14 always states Full/Partial + reason; a partial
  names a baseline part number + revision; never alter the original FAIR.
- **Rationale**: re-FAI triggers (design change, process/source/location/tooling/NC
  program change, 2-year lapse, corrective action) usually affect a subset.

### 5. Form 2 is manual everywhere — except in an ERP with traceability

- **Net-Inspect / InspectionXpert**: "ADD Material/Process/Testing" by hand; certs
  attached as documents.
- **DISCUS**: "Bill of Documents" attached to the FAIR package.
- **ProShop**: lot numbers flow from vendor POs; package includes all certs.
- **SAP**: "production chain" result origin pulls component batch values through
  batch where-used into the outgoing certificate.
- **Rationale**: materials and special processes are purchased; only the system that
  received them knows supplier, spec, cert number and lot.

### 6. CofC = one signed certificate per shipment, lot/serial per line

- **SAP**: certificate at delivery-item level (one per item, listing all batches);
  profile assigned by material or material+customer; triggered by delivery output;
  archived per print; no issued-certificate versioning.
- **ProShop**: two kinds — work-order CofC (full WO qty) and **shipment CofC** (from the
  packing slip, allows partials/overages); per-line print; settings precedence
  Part > Contact/Customer > Global > Default; signature/date from "Certified to Run" on
  final inspection.
- **NetSuite**: auto Certificate of **Analysis** at item fulfillment, one page per lot.
- **E2**: "Print Certifications" flag on customer ship-to, flows to orders/packing lists.
- **Epicor**: nothing out of the box — custom fields + modified pack-slip report; the
  item-level flag problem ("fires for every customer") shows the requirement is
  per-customer.
- **Lockheed QX / Northrop / DRS / Ducommun**: one CoC per shipment; PO (+ line);
  part number + revision; serials/lot/date code; qty (DRS: PO qty and qty shipped);
  manufacturer/lower-tier supplier & service if different; positive **unqualified**
  statement ("to the best of our knowledge" rejected) + records-on-file statement;
  authorized signer printed name, title, signature, date; e-signature accepted.
- **Rationale**: AS9100D 8.6 requires release records traceable to the person
  authorizing release and all accompanying documents present at delivery.

### 7. Compliance statements are configurable boilerplate, scoped by customer/part

- **ProShop**: Part > Customer > Global precedence.
- **Epicor**: BAQ-driven "part-specific verbiage".
- **Primes**: DFARS 252.225-7009 specialty metals (melt country), counterfeit parts
  252.246-7007/-7008, RoHS, REACH, conflict minerals, mercury-free, shelf-life
  (expiry + % remaining), FOD. ITAR/EAR Destination Control Statement is required only
  on the commercial invoice, so it's optional on a CofC.
- **Rationale**: every customer's Q-clauses differ; structured statements beat
  template forks.

## Answers to Research Questions

1. **What entities and lifecycle does an FAI have; triggers; partial/delta?** — A FAIR
   header (Form 1 fields, full/partial + reason + baseline, status, signatures)
   wrapping a Bill of Characteristics + results (Form 3) and material/process rows
   (Form 2) plus attached documents (Net-Inspect, High QA). Lifecycle: In-Work →
   Complete/Not Complete → (Submitted → Pending Buy-off → Approved / Approved
   Conditionally / Disapproved) with lock on approval (Net-Inspect). Triggers per Rev C
   §4.6: new part, design change, source/process/inspection method/tooling/material/
   location change (incl. BOM), NC program change, natural/man-made event, corrective
   action to finish a prior FAI, 2-year production lapse. Partial = baseline copy,
   affected characteristics only, never alter the original. No vendor publicly
   documents *automatic* trigger detection — an opportunity.
2. **What does Rev C require on Forms 1/2/3, and what can be derived?** — Full field
   tables in the Competitor-Specific Details (AS9102) section below. Derivable in
   Carbon: F1 1/2/5 (item + revision), 3 (serial from inspection sample tracked
   entity), 4 (sequence), 6/7 (inspection document drawing no. — needs a drawing
   *revision*), 8 (ECOs via change orders — partial), 9 (job / routing id), 10
   (company), 11/12 (customer supplier code / customer PO from sales order), 15–18
   (job BOM children + their FAIR ids), 19 (derived from linked NCRs), 20–23 (signers);
   F2 5/6/8/10 (from consumed lots → receipts → supplier + cert docs; outside-operation
   POs → special process supplier) — spec numbers and cert numbers need new fields;
   F3 5–11 from `inspectionFeature` + `inspectionMeasurement` + NCR links —
   designator, reference location, text result and gauge need new fields.
3. **How are characteristics linked to measurements?** — Balloon number is the key;
   repeated features (4X) may be one characteristic with each value or a min/max pair,
   any failing instance listed separately; attributes record pass/fail; CMM reports
   attach only if char numbers match and values are actual geometry (not deviation);
   Field 10 carries the tooling/gauge ID; Field 11 the NCR number (IAQG forms; 1factory;
   InspectionXpert; ProShop bulk CSV import creates an NCR per out-of-tolerance value).
4. **What goes on a CofC; signer; per shipment vs line; certs?** — See Pattern 6. One
   per shipment (Lockheed QX), each line with PO line, part + rev, qty, lot/serial; a
   partial shipment's CofC covers only that quantity (DRS); multiple lots itemized with
   qty per lot (Plexus, Ducommun); raw material lot/heat referenced to link to the mill
   cert (Ace Thermal); sub-tier special-process CofCs attached (Ace, Ducommun B7);
   signed by an authorized quality representative with printed name/title/date;
   e-signature accepted (LM, NG). SAP attaches at delivery item; ProShop per packing
   slip line.
5. **Delivery: shipments, portals, retention?** — SAP: output determination on the
   delivery → print/email/EDI (QCERT IDoc with signed PDF), ArchiveLink storage. Lockheed
   requires a copy inside the box. Net-Inspect is the mandated digital FAIR exchange for
   Airbus/Northrop/Boeing. No ERP publicly documents portal download of CofCs.
   Retention: AS9102/AS9100 set no period — per contract/QMS; approved FAIRs are locked.
6. **Terminology?** — "First Article Inspection Report (FAIR)", "FAIR Identifier",
   "Bill of Characteristics", "characteristic designator" (Key / Critical), "partial
   FAI" (Net-Inspect says "Delta"), "baseline part number", "Certificate of Conformance"
   (industry abbreviates CoC / C of C / CofC; AS9163 uses CoC); SAP's generic "quality
   certificate". Certificate of **Analysis** = actual values per batch (NetSuite, SAP
   inspection certificate) — distinct from a conformance statement.

## Competitor-Specific Details

### AS9102 Rev C forms (IAQG)

R = required, CR = conditionally required, O = optional. Fields 1–4 repeat on every
form. Custom forms are acceptable if every R/CR field is present with the same numbers.

**Form 1 — Part Number Accountability**

| # | Field | Req |
|---|---|---|
| 1 | Part Number | R |
| 2 | Part Name | R |
| 3 | Serial Number | CR |
| 4 | FAIR Identifier | R |
| 5 | Part Revision Level ("N/C" if none) | CR |
| 6 | Drawing Number (multiple allowed) | CR |
| 7 | Drawing Revision Level | CR |
| 8 | Additional Changes (ECOs, deviations) | CR |
| 9 | Manufacturing Process Reference (router/plan id) | R |
| 10 | Organization Name | R |
| 11 | Supplier Code | O |
| 12 | Purchase Order Number | O |
| 13 | Detail / Assembly | R |
| 14 | Full / Partial FAI + Baseline Part Number (w/ rev) + Reason | R |
| 15–18 | Index (assemblies): Part Number, Part Name, Part Type (detail / sub-assembly / software / standard catalogue / COTS), FAIR Identifier | CR |
| 19 | Does FAIR contain a documented nonconformance? Y/N | R |
| 20 / 21 | FAIR Verified By / Date | R |
| 22 / 23 | FAIR Reviewed/Approved By (≠ 20) / Date | R |
| 24 / 25 | Customer Approval / Date | CR |
| 26 | Comments | O |

**Form 2 — Product Accountability: Raw Material, Specifications, Special Processes,
Functional Testing**: 5 Material or Process Name · 6 Specification Number (spec + form;
process spec + class) · 7 Code (O) · 8 Supplier (name/address/code) · 9 Customer
Approval Verification (Y/N/NA; No = nonconformance) · 10 Certificate of Conformance
Number · 11 Functional Test Procedure Number · 12 Acceptance Report Number · 13
Comments (O).

**Form 3 — Characteristic Accountability, Verification and Compatibility Evaluation**:
5 Char. No. (R) · 6 Reference Location (CR) · 7 Characteristic Designator (CR) · 8
Requirement (R; drawing units; software revision for software) · 9 Results (R) · 10
Designed/Qualified Tooling (CR) · 11 Nonconformance Number (CR) · 12 Additional Data /
Comments (O).

**Rev B → C deltas**: FAIR Number → FAIR Identifier (now R, on all forms); field 14
reason required for full *and* partial; F1-17 Serial → Part Type, all BOM parts listed;
F1-19 is the nonconformance question (replaces "FAI complete/not complete" +
signature); signatures only on Form 1, Reviewed/Approved by a different person; F3
comments → field 12; software revision recorded; FAI is not a product acceptance
document; documented FAI planning process required; single-run exemption removed.

**Electronic formats**: no IAQG/SAE exchange format. Net-Inspect is a commercial
portal. QIF (ISO 23952) maps to Forms 1 and 3 only (NIST demo) — relevant for CMM
import later.

### SAP S/4HANA QM

- Certificate profile (QC01): versioned, released; characteristics with **result
  origin** (inspection lot results, batch classification, production chain via batch
  where-used, or custom function module).
- Profile assignment (QC15 / Fiori QC19) by material, material group, or
  material+customer (customer-specific wins), with validity dates; no profile ⇒ no
  certificate.
- Recipients via output condition records; LQCA (ship-to) / LQCB (sold-to) on the
  delivery item output procedure; print/fax/email/EDI (QCERT IDoc + signed PDF).
- Standalone print for delivery (QC20), inspection lot (QC21), batch (QC22).
- Archived via ArchiveLink per print; profiles versioned, issued certificates not.
- Batch split items don't get their own certificate by default (one per delivery item
  lists all batches).
- Terminology: certificate types range from a pure conformance statement to an
  inspection certificate with actual values (≈ CoA).
- FAI: procurement-only — quality info record status profile / PPAP tab drives
  inspection type 0101 / plan usage 51 at goods receipt. No in-house FAI, no
  revision-change trigger, no AS9102 output.

### ProShop ERP

- FAI form on the work order's first part; AS9102 formatting on demand; auto-fills
  from ERP data; bulk CSV import of FAI/IPC results with column mapping and one NCR per
  out-of-tolerance value.
- Shipment CofC from the packing slip (partials/overages) vs work-order CofC (full
  qty); per-line print; Part > Customer > Global > Default settings precedence;
  signer/date from "Certified to Run" on final inspection.
- One-button package: every FAI for a multi-level BOM + certs + ballooned drawing +
  CofC.

### Net-Inspect

- FAIR = Form 1/2/3 + Documents + Workflow + Checklist.
- Create new / copy from existing (choose sections; **Delta** flag with parent–child
  link) / import (DISCUS, InspectionXpert, Excel).
- Statuses: Complete / Not Complete; Submitted; Pending Buy-off; customer Approve /
  Approve Conditionally / Disapprove with per-field rejection comments; approval locks.
- Rev C: one Form 1 signature locks all forms.

### 1factory, High QA, DISCUS, InspectionXpert

- Auto-ballooning (OCR / PMI) → Bill of Characteristics with designator, sheet/zone,
  notes; rule-based exclusion of basic/reference dims (High QA).
- CMM import parsers: PC-DMIS, Calypso first; CSV/Excel with column mapping to balloon
  numbers; QIF export only (DISCUS).
- Revision compare to scope partial FAI (1factory).
- Output: AS9102 Excel/PDF templates with a template editor; Net-Inspect push/append;
  FAIR package (ZIP / multi-page PDF with Bill of Documents).
- 1factory: FAI plan becomes the production control plan.

### Epicor, E2, JobBOSS², NetSuite, Fulcrum

- Epicor: no native CofC — custom Customer Shipment fields + SSRS pack-slip + BAQ; P21
  item-level flag problem shows it must be per customer.
- E2: "Print Certifications" on customer ship-to; outside-service "Certifications
  Required" flags the vendor PO.
- JobBOSS²: certification form + customer packets; users asked for material certs +
  lot data on packing lists (gap).
- NetSuite: Certificate of Analysis at item fulfillment, one page per lot.
- Fulcrum: raw-material certs attached to the item lot at receiving.

### What Carbon already has (codebase map)

Exists:
- `inspectionDocument` (partId → item revision, drawingNumber, internal `version`,
  PDF) and `inspectionFeature` (label, pageNumber, description, nominal/tolerance ±/unit
  as TEXT, `type` = `procedureStepType`), `balloon` geometry
  (`20260421120000_balloon-document-tables.sql`).
- Inspections linked to job operations and receipts: `inspection` (sourceDocument
  'Receipt' | 'Job Operation', status Pending/In Progress/Passed/Failed/Partial),
  `inspectionSample` (trackedEntityId = serial/lot), `inspectionMeasurement`
  (inspectionFeatureId, `value NUMERIC`, status, notes, inspectedBy/At) with auto
  pass/fail (`packages/database/src/quality.ts:661-790`), sampling plans
  (All/First/Percentage/AQL).
- NCR links: `nonConformanceInspection`, `nonConformanceTrackedEntity`,
  `...JobOperation`, `...ShipmentLine`; readable `nonConformanceId`.
- Traceability graph (`trackedEntity` / `trackedActivity`); shipped lots via
  `getShipmentLineTracking`; received lots carry Receipt / Supplier / PO attributes.
- Gauges + calibration records.
- Shipment + packing slip PDF served by `routes/file+/shipment+/$id[.]pdf.tsx` via the
  document template system; posted packing slip stored as a `document` (only when the
  SO has an opportunity).
- `customerPartToItem` (customer part id + revision); company header data on PDFs.
- Document template customizer: 9 template types, one template per company per type.

Gaps:
1. No characteristic designator (Key/Critical), no characteristic kind (dimension /
   note / material / process / test), no reference location (sheet/zone), labels unique
   only per page.
2. No drawing **revision** on `inspectionDocument` (only an internal counter).
3. `inspectionMeasurement.value` numeric only — no text/attribute result ("Accepted").
4. No gauge on a measurement; no calibration check at entry.
5. No first-article concept (full/partial, reason, baseline, signatures, status).
6. No material/special-process cert entity tied to a received lot; receipt-line files
   are bare storage objects; no cert number / spec fields.
7. No CAGE code / supplier code fields.
8. No CofC or FAIR document template type, PDF, or route.
9. Customer part number not on shipment lines (resolve via SO line / `customerPartToItem`).
10. Shipment posting doesn't email; portal doesn't expose shipments; no final/
    pre-shipment inspection source.

## Recommended Approach for Carbon

1. **Ship CofC first, per shipment, from the packing slip** (ProShop shipment-CofC +
   Lockheed QX "one per shipment"). New document template type
   `certificateOfConformance` in the existing customizer, a
   `file+/shipment+/$id.cofc[.]pdf.tsx` route, one table row per shipment line with
   customer PO + line, customer part number + revision, our part + revision, qty
   shipped, and every shipped lot/serial with its quantity (from
   `getShipmentLineTracking`). Partial shipments naturally cover only their quantity
   (DRS rule).
2. **Positive, unqualified conformance statement + configurable compliance
   statements** with precedence Item > Customer > Company default (ProShop; Epicor's
   per-customer lesson). Statements are data (a small library: specialty metals,
   counterfeit parts, RoHS, REACH, conflict minerals, mercury, shelf-life, FOD,
   export), not template forks. Always include the records-on-file sentence (DRS).
3. **Authorized signer is a recorded e-signature**: name, title, timestamp captured
   when the CofC is issued, by a user holding a quality permission (AS9100 8.6 release
   traceability; LM/NG accept e-signatures). Issued CofCs are stored as a `document`
   on the shipment and **re-issue creates a new numbered revision**, never overwrites
   (fills SAP's no-versioning gap).
4. **Customer-level "CofC required" flag** that auto-issues on shipment post (E2
   ship-to flag; SAP material+customer assignment). Manual issue always available.
5. **Model the FAIR as a header over an existing `inspection`** (Net-Inspect / ProShop
   pattern) — do not build a parallel measurement store. Form 3 renders from
   `inspectionFeature` + `inspectionMeasurement` rows of the FAI serial's sample; Form
   1 fields derive from item/revision, inspection document, job, company, customer PO;
   the FAIR stores only what can't be derived (full/partial, reason, baseline FAIR,
   comments, signatures, customer approval, status).
6. **Extend characteristics minimally for Form 3**: designator (None/Key/Critical),
   reference location, sortable characteristic number unique per document, a text
   result on measurements for notes/attributes, optional gauge id on a measurement,
   and a drawing revision on `inspectionDocument`.
7. **Auto-fill Form 2 from traceability — Carbon's differentiator** (SAP "production
   chain", ProShop). Walk the FAI serial's lineage to consumed lots → receipts →
   supplier; outside-operation POs → special-process supplier. Needs a cert attachment
   + cert number on received lots. Always allow manual rows.
8. **Rev C sign-off semantics**: Verified By ≠ Reviewed/Approved By (enforced); field
   19 derived from linked NCRs; approval locks the FAIR; a new FAI is a new record
   (partial references its baseline) — never edit an approved one.
9. **Detect, don't block, FAI triggers**: flag a job "FAI required" when no approved
   FAIR exists for the item revision, or the last production of that revision is older
   than 2 years (no vendor documents this publicly — cheap differentiator).
10. **Defer**: AS9102 Excel export, Net-Inspect API push, QIF/CMM import, CofC email
    and customer-portal exposure, Certificate of Analysis (actual values), assembly
    FAIR packages bundling child FAIRs.

## Follow-up research and resolved questions (2026-09-25)

User answers: signer = anyone for now · FAI-due = warn, never block · customer approval
= captured in Carbon, optional · AS9163, bonus tolerance and Form 2 architecture =
research and decide.

### A. AS9163 / EN 9163 CoC template — the default CofC layout

IAQG publishes the template free (SCMH 5.2.4 "CofC Template 9163 Rev B", 9 Mar 2023)
and prEN 9163:2021 §4.1 lists the same 14 fields as the minimum content. **All 14 are
mandatory**; a non-applicable field reads "N/A" or "None", never blank (§5.2). A custom
layout is allowed only if it carries all 14 with the same reference numbers (§4.3a).

| # | Field | Level | Carbon source |
|---|---|---|---|
| 1 | Page Number | header | renderer |
| 2 | Certificate Number | header | new sequence (unique) |
| 3 | Date | header | issue date |
| 4 | Organization (External Provider) Name and Address | header | `company` |
| 5 | Customer Name and Address | header | `shipment.customerId` → customer + ship-to |
| 6 | Purchase Order Number | header | sales order `customerReference` |
| 7 | Item Number | line | PO line / customer part number (Annex C unseen — print both: customer part + our part) |
| 8 | Quantity | line | `shipmentLine.shippedQuantity` |
| 9 | Description | line | item name / description |
| 10 | Revision | line | item revision (customer revision when mapped) |
| 11 | Traceability | line | shipped lots/serials (`getShipmentLineTracking`) with qty each |
| 12 | Remarks | line | free text per line |
| 13 | Conformity Details | block | shelf-life expiry; FAI identifier + reference; material certs; process certs; customer approval / concession refs; other customer/regulatory elements; nonconformance refs; **reason for update when revised** |
| 14 | Statement of Conformity + name and signature of the authorized releaser | block | fixed statement + signer |

Field 14 statement (§4.2, "indicate or be equivalent to"): *"It is hereby certified
that apart from the deviations, concessions, or waivers noted in "Conformity Details",
the product(s) / service(s) detailed above has (have) been manufactured / maintained /
reworked / performed / inspected / tested and conform to applicable specifications,
drawings, and purchase order and contract requirements."*

Rules that shape the design:
- Many items on one CoC is allowed unless the customer says otherwise; each item must
  link unambiguously to its PO line (§5.1). One-per-shipment is a customer rule
  (Lockheed QCOC), and matches per-shipment issue.
- Continuation annexes are allowed if tied by the certificate's unique id (§4.3b) —
  long lot/serial lists can overflow onto continuation pages.
- Deviations / concessions / NCRs are listed in #13; the statement excludes them (§5.3).
- Signer: the org must control who can sign (§5.4) — left to the org; a personal
  signatory code may replace the name if traceable to one person (§5.5).
- **Electronic CoCs are allowed** (§5.7) when only authorized users can generate and
  validate them and #14 carries "Document electronically generated and validated." (or
  equivalent); a signature image is optional.
- English and/or customer language (§4.4); retain in a secured, backed-up store for the
  longest applicable period (§5.8–5.9).
- 8130-3 / EASA Form 1 are out of scope and cannot be replaced by a CoC.
- Unknown: Annex C per-field instructions (paywalled); final-text deltas vs the 2021
  draft.

**Decision**: the default CofC template IS the 9163 layout with fields 1–14 numbered.
Compliance statements (Pattern 7) render inside #13 "other conformity elements". Reissue
creates a new revision and fills "reason for update" in #13.

### B. Bonus tolerance (MMC / LMC)

- ASME Y14.5: bonus exists only when the feature's own tolerance carries Ⓜ/Ⓛ; it is the
  departure of the actual mating size from the stated material condition. MMC of a hole
  = smallest size, of a pin = largest; LMC reversed. Bonus is clamped to
  `[0, size tolerance]`. Allowable = stated tolerance + bonus (Tec-Ease; PC-DMIS docs).
- **Datum shift is not bonus** and must never be added arithmetically — it needs a
  constrained best fit across the pattern (Tec-Ease; PC-DMIS). Ignoring it is
  conservative (may reject a good part, never accepts a bad one).
- Form 3 expectations: requirement column shows the drawing callout as written; results
  show the **actual** geometric value (not deviation, not raw coordinates — GKN); the
  size is its own balloon; when actual > stated but passes, write "Accept with MMC/LMC"
  (L3Harris QA-01.1.1 §2.3.12.3) with bonus/allowable so a reviewer can re-check.
- Tools: CMM software (PC-DMIS, Calypso) computes bonus; QC-Calc has an MMC mode; none of
  the FAI point solutions publicly documents linking a GD&T characteristic to its size
  characteristic to compute it.

**Decision**: compute the feature's own bonus, never datum shift.
- Characteristic: `materialCondition` (RFS default / MMC / LMC) + `sizeFeatureId` (the
  size balloon, required when MMC/LMC) + internal/external (hole vs pin).
- Measurement: stores the actual; at write time snapshot `bonus` and `allowable` so a
  later edit to the spec or the size result never changes a signed FAIR.
- Pass = size in tolerance AND actual ≤ allowable. Stated tolerance 0 at MMC is valid.
- Optional `allowableOverride` + reason for a CMM-reported allowable that includes datum
  shift (attach the CMM report).
- Form 3 prints the callout as written, the actual, and "Accept with MMC (bonus X,
  allowable Y; size #N)" when bonus was needed.
- Pitfalls to guard in code: diametral zone (a radial deviation must be doubled), MMC
  direction by internal/external, per-instance bonus in patterns, out-of-tolerance
  size fails regardless of bonus. Tolerances are TEXT today — bonus requires the
  numeric parse the evaluator already does.

### C. Form 2 auto-fill — Carbon architecture inputs

Facts from the codebase:
- `document` links to exactly ONE source (`sourceDocument` + `sourceDocumentId`), enum
  latest in `20260916090307`; storage `${companyId}/${folder}/${id}/${name}`.
  Receipt-line uploads live at `${companyId}/inventory/${lineId}` with a `document` row
  pointing at the **receipt**, not the line, and carry no cert number or type.
- Tracked entities have no attachments. `batchProperty` (per-item custom lot fields) is
  merged into `trackedEntity.attributes` at receipt — batch items only.
- Received root entities carry `Receipt`, `Receipt Line`, `Supplier` attributes (not the
  PO — reach it via `receipt.sourceDocumentId` / `receiptLine.lineId`). Consumed lots are
  often split children — walk ancestors through `Split` to the received root
  (`get_direct_ancestors_of_tracked_entities_strict`, `fetchJobScopedLineage`).
- Consumption: `issue` writes a `Consume` trackedActivity (inputs = consumed lots,
  output = parent serial) + `itemLedger` "Job Consumption" rows with `trackedEntityId`.
- Outside processing: `jobOperation.operationType = 'Outside Processing'`,
  `purchaseOrderLine.jobOperationId` → PO → supplier; the receipt marks the op Done but
  writes no tracked-entity / ledger rows. `process` has no spec field; `supplierProcess`
  is pricing only.
- No "specification" column exists anywhere (item, material, methodMaterial,
  jobMaterial). `material` has grade/substance/form ids.
- Functional tests: `procedure` (name, `version`, status) on `jobOperation.procedureId`;
  results in `jobOperationStepRecord` (no tracked entity).
- Change orders: `findChangeNoticesForItem` (`items.service.ts:6943`) for Form 1 field 8.

**Decision — one certification record, one resolver, two consumers.**
1. **`certificate`** (new, company-scoped): `type` (Material | Special Process |
   Functional Test | Other), `certificateNumber`, `specification` (free text: spec +
   class/form), `supplierId`, optional `documentId` (the PDF), `expiresAt`, notes. It
   attaches to what it certifies through **one link column pair**, not a join table
   per target: the **receipt line** (covers every lot received on it — material certs
   and outside-processing certs both arrive on a receipt) or a **job operation** (an
   in-house test or process). One record, not one per lot — a mill cert covers a heat,
   and a receipt line is how Carbon already groups the lots of that heat.
2. **Resolver** `getCertificationLineage(trackedEntityIds | jobId)` walks the lineage the
   system already records: consumed lots → split ancestors → received root →
   `Receipt Line` → certificates (Material); job's Outside Processing ops →
   `purchaseOrderLine.jobOperationId` → receipt lines → certificates (Special Process,
   process name from `process`, supplier from the PO); job ops with a certificate of
   type Functional Test (procedure name + version as the procedure number).
3. **Consumers**: FAI Form 2 is **seeded** from the resolver into stored, editable rows
   (add / remove / edit, then frozen at approval — a FAIR must not change after
   sign-off). CofC field 13 lists the same certificates for the shipped lots, read at
   issue time and frozen in the issued PDF.
4. **Missing-cert warnings, never blocks**: a received line of a Material item with no
   certificate, or an Outside Processing op with none, surfaces as a warning on the FAI
   and at CofC issue (consistent with the warn-not-block decision).
5. Capture UX: add a certificate from the receipt line (upload + number + spec) — the
   existing receipt-line upload is where users already put these PDFs.

### D. Remaining policy decisions (resolved)

- **Signer**: any company user may sign a CofC or FAIR in v1 (user decision). Record
  user id, printed name, title (from the employee's job title where available) and
  timestamp; print "Document electronically generated and validated." (9163 §5.7).
  Permission gating can be added later without a data change.
- **Verified By ≠ Approved By** (Rev C field 22 "should not be the same"): warn, do not
  block — a one-person quality shop must still be able to finish an FAI.
- **FAI due**: warn on the job and at CofC issue, never block (user decision).
- **Customer approval** (F1 24/25): optional name + date (+ optional attachment) on the
  FAIR (user decision).
- **Retention / immutability**: issued CofC and approved FAIR PDFs stored as `document`
  rows; approval locks the FAIR; reissue creates a new revision.

## Sources

AS9102 / standards
- https://iaqg.org/wp-content/uploads/2023/03/Draft-9102-Rev-C-Forms.pdf
- https://iaqg.org/wp-content/uploads/2019/10/9102_Changes_07112023.pdf
- https://iaqg.org/wp-content/uploads/2019/10/9102-FAQ.pdf
- https://iaqg.org/wp-content/uploads/2020/02/9102B_form1.pdf
- https://www.net-inspect.com/blog/as9102-rev-b-vs-rev-c/
- https://www.discussoftware.com/news/as9102-rev-c-what-you-need-to-know/
- https://www.dukaneseacom.com/wp-content/uploads/2025/06/AS9102-RC-Supplier-FAI-Training.pdf
- https://www.telephonics.com/uploads/standard/TCX-9102.pdf
- https://www.lmiaerospace.com/download_file/view/bc27e369-997d-4151-a3d3-7454199613c2/273
- https://www.gknaerospace.com/media/mpibej0a/as9102-first-article-inspection-report-common-mistakes.pdf
- https://www.lockheedmartin.com/content/dam/lockheed-martin/aero/documents/scm/Quality-Requirements/Clauses/q2a_rev13.pdf
- https://www.nist.gov/publications/first-article-inspection-requirement-report-generation-qif-using-c-codesynthesis-and
- https://www.iso.org/standard/77461.html
- https://webstore.ansi.org/standards/sae/sae91632022
- https://elsmar.com/elsmarqualityforum/threads/as9163-certificate-of-conformance-requirements.84885/
- https://elsmar.com/elsmarqualityforum/threads/as9100d-clause-8-6-documentation-required-to-show-evidence-of-conformity.85321/
- https://advisera.com/9100academy/blog/2019/06/05/as9100-traceability-requirements-how-to-meet-them/

CofC requirements (FAR/DFARS/primes)
- https://www.acquisition.gov/far/52.246-15
- https://www.acquisition.gov/far/46.504
- https://www.acquisition.gov/dfars/252.225-7009-restriction-acquisition-certain-articles-containing-specialty-metals.
- https://www.acquisition.gov/dfars/252.246-7008-sources-electronic-parts.
- https://www.ecfr.gov/current/title-22/chapter-I/subchapter-M/part-123/section-123.9
- https://www.lockheedmartin.com/content/dam/lockheed-martin/aero/documents/scm/Quality-Requirements/Quality-Appendices/AppQX_rev10.pdf
- https://cdn.northropgrumman.com/-/media/Supplier-Documents/Quality-Documents/Q31500-03-PGSF.pdf
- https://www.leonardodrs.com/wp-content/uploads/2023/06/scm-004-frm-common-quality-clauses_rev-r.pdf
- https://www.ducommun.com/pdf/38-4000%20Quality%20Clauses%20-%20Carson%20(Rev.%20U).pdf
- https://acethermalsystems.com/wp-content/uploads/2024/07/Quality-Clauses-Rev-T.pdf
- https://www.boeingsuppliers.com/become/quality/faq
- https://www.plexus.com/resource-download/1U2l6mE1bzjhjwWu2M_9gDmapknDhxHLo/

SAP
- https://help.sap.com/doc/d26eb6531de6b64ce10000000a174cb4/2.6/en-US/b46eb6531de6b64ce10000000a174cb4.html
- https://learning.sap.com/courses/applying-sap-s-4hana-quality-management/processing-quality-certificates_b8482f42-b266-4603-9653-a9081f42c53e
- https://help.sap.com/docs/SAP_ERP/250374f0514e4e0f9057066374265eba/4f6eb6531de6b64ce10000000a174cb4.html
- https://help.sap.com/doc/d26eb6531de6b64ce10000000a174cb4/2.6/en-US/72a8b9537cceb44ce10000000a174cb4.html
- https://help.sap.com/doc/d26eb6531de6b64ce10000000a174cb4/2.6/en-US/7669b65334e6b54ce10000000a174cb4.html
- https://sapinsider.org/sap-qm-first-article-inspections-help-ensure-proper-approval-of-new-materials/
- https://sapinsider.org/efficiently-manage-incoming-quality-certificates-in-the-procurement-process/
- https://blog.sap-press.com/first-article-inspection-for-production-part-approval-in-sap-s4hana
- https://community.sap.com/t5/enterprise-resource-planning-q-a/first-article-inspection-for-production/qaq-p/12776851
- https://answers.sap.com/questions/10144277/quality-certificate-for-individual-batch-split-ite.html

FAI point solutions
- https://1factory.com/fai-ballooning-software.html
- https://1factory.com/manufacturing-quality.html
- https://highqa.com/first-article-inspection/
- https://highqa.com/inspection-manager-360-core/
- https://highqa.com/blog-fai-what-and-when/
- https://www.net-inspect.com/solutions/first-article-inspection-software/
- https://www.net-inspect.com/assets/help/Version%205%20User%20Guide_All%20Modules%20V3.pdf
- https://cdn.northropgrumman.com/-/media/Supplier-Documents/Announcements/2024_NetInspectRequiredFAIRSubmissionsApprovals.pdf
- https://www.discussoftware.com/fai-optimization/products/desktop/cmm/
- https://www.discussoftware.com/general/announcing-update-discus-2024-u1-is-released/
- https://www.inspectionxpert.com/fai/as9102
- https://help.inspectionxpert.com/how-to-use-the-net-inspect-append-/-overwrite-function
- https://support.inspectionxpert.com/portal/kb/articles/supported-cmm-file-types-updated-2017

AS9163 / EN 9163
- https://iaqg.org/wp-content/uploads/2023/12/SCMH-5.2.4-CofC-Template-9163-Rev-B-Dated-9MAR23.docx
- https://cdn.standards.iteh.ai/samples/73367/f3dc5d83e863449ebc809fd84b94f1b1/oSIST-prEN-9163-2021.pdf
- https://cdn.standards.iteh.ai/samples/73367/a1397736e7714befbe9881906396ad51/SIST-EN-9163-2024.pdf
- https://iaqg.org/wp-content/uploads/2019/10/Supporting-Standard-Certificate-of-Conformance-Initiative-supporting-paper-V3.pdf
- https://www.lockheedmartin.com/content/dam/lockheed-martin/eo/documents/suppliers/space/spacedoc-253-01-042025.pdf
- https://www.sae.org/standards/as9163-aerospace-series-certificate-conformity-requirements

Bonus tolerance
- https://www.tec-ease.com/gdt-tips-view.php?q=211
- https://www.tec-ease.com/gdt-tips-view.php?q=223
- https://docs.hexagonmi.com/pcdmis/2023.1/en/helpcenter/mergedProjects/core/geometric_tolerances/Evaluating_Size_with_the_Geometric_Tolerance_Command.htm
- https://docs.hexagonmi.com/pcdmis/2019.1/en/helpcenter/mergedProjects/core/feature_control_frames/Position_Feature_Control_Frame_Dimension_Information.htm
- https://qualityforum.zeiss.com/migration/images/333_3eb48855db19ad0b54011ecf8050969e.pdf
- http://www.thecmmstore.com/products/software/prolink/media/QC-CALC_33.pdf
- https://www.l3harris.com/sites/default/files/2024-12/Supplier%20FAI%20Requirement_QA-01.1.1.pdf
- https://mavlon.co/post/mmc-bonus-tolerance-calculation
- https://cadnexa.com/blog-bonus-tolerance-mmc.html

ERPs
- https://proshoperp.com/product/quality-systems-inspection/
- https://proshoperp.com/blog/bulk-work-order-process-fai-ipc-imports/
- https://proshoperp.com/blog/achieving-full-traceability-shop-floor/
- https://dhelp-f4b211c7-65b6-4a56-a690-67f58ddac296.adionsystems.com/docs/doku.php?id=help:modules:packingslips:module_help:full_page_cofc:start
- https://www.epiusers.help/t/certificate-of-conformance-order-entry-check-box/92482
- https://www.epiusers.help/t/c-of-c-on-pack-slip/91084
- https://www.epiusers.help/t/p21-printing-a-certificate-of-conformance-with-a-packing-list/81400
- https://client.shoptech.com/faq/Enterprise/Manuals/User_Guide.pdf
- https://www.ecisolutions.com/products/jobboss2/features/
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_163274330949.html
- https://fulcrumpro.com/manufacturing-software/shipping-receiving
