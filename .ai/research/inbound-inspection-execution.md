# Inbound Inspection Execution UI Research: Best Practices Survey

## Summary

Researched how ERP/QMS systems execute inbound/receiving inspection when a
characteristic-based inspection plan (ballooned drawing → bill of
characteristics) meets AQL sampling (sample size, accept/reject numbers),
per-sample measurement entry, pass/fail disposition, and NCR creation. Key
findings: (1) the industry-standard model is an **inspection lot** whose plan is
a **bill of characteristics** extracted from a ballooned drawing; (2) sampling
is resolved **per characteristic** (SAP, 1factory, High QA all do this — the
lot sample size is the max across characteristics); (3) measurements are
auto-valuated against tolerances (out-of-tolerance auto-rejects the reading)
but the **lot disposition is always a human decision** — SAP has auto-accept
for clean passes, never auto-reject; (4) NCRs are born from the inspection with
one click / auto-activation, pre-populated with the failed characteristics and
lot references; (5) the consensus execution UI is a **split view: PDF drawing
with balloons beside a characteristics × sample-units grid**, with balloon↔row
synchronization and out-of-tolerance color coding.

## Competitors Surveyed

- **SAP S/4HANA / ECC (QM)** — the enterprise reference model: inspection lot,
  master inspection characteristics, sampling procedures/schemes, usage
  decision, quality notifications.
- **1factory** — point-solution leader for incoming quality control in
  machining/discrete; drawing ballooning → incoming inspection plans → grid
  execution → NCR/SCAR.
- **High QA (Inspection Manager)** — ballooning + bill-of-characteristics
  authoring with shop-floor execution apps; per-dimension AQL sampling.
- **ProShop ERP / Fulcrum / Net-Inspect** — adjacent references for
  receiving-workflow integration, permission-tiered dispositions, and FAI
  results-review UI.

## Key Consensus Patterns

### 1. Inspection plan = bill of characteristics from a ballooned drawing

- **SAP**: inspection plan (task list) → operations → numbered inspection
  characteristics referencing versioned Master Inspection Characteristics
  (quantitative with tolerances, or qualitative pass/fail via catalogs). Plans
  are selected per material or material+vendor.
- **1factory**: "A Quality Control Plan defines the Bill of Characteristics
  (what to measure), the associated specifications and tolerances, the
  inspection methods (how to measure), and the sampling rules (how many to
  measure)." Built by OCR auto-ballooning or point-and-click on the PDF.
- **High QA**: one-click ballooning generates the Bill of Characteristics;
  tools, criticality, and sampling get assigned per characteristic.
- **Rationale**: the drawing is the contract; every measurable requirement
  becomes a numbered characteristic that flows through FAI, incoming,
  in-process, and final inspection from one master.

### 2. Sampling resolves per characteristic; the lot inherits the max

- **SAP**: each characteristic carries its own sampling procedure; sample size
  is computed per characteristic at lot creation; the lot-level sample is the
  largest characteristic sample. Sampling schemes are ISO 2859-1/3951 tables:
  severity × AQL × lot-size → n, c (accept), d (reject), k-factor.
- **1factory**: "Auto-calculate sample size for each feature based on lot size
  and sampling plan. Ensure all required measurements are recorded before
  inspections are closed." Supports C=0, ANSI Z1.4 (General I–III, Special
  I–III), MIL-STD-1916, custom.
- **High QA**: "define and apply sampling thresholds for each dimension"; AQL
  sampling linked directly to the Bill of Characteristics.
- **Rationale**: critical dimensions warrant larger samples than minor ones
  (AQL tiers map to criticality: critical 0.065–0.65, major 1.0–2.5, minor
  higher); a single lot-level sample size over- or under-inspects.

### 3. Auto-valuation of readings; human disposition of the lot

- **SAP**: a measured value outside tolerance is auto-valuated Rejected for
  that unit; the characteristic accept/reject follows the valuation mode
  (attributive: defects ≤ c accepts; variable: k-method). But the **usage
  decision is a person**: a lot with rejected characteristics can still be
  accepted ("accepted with deviation"); automatic UD exists only for the
  clean-pass path (no rejected characteristics, no defects) — never automatic
  rejection.
- **1factory**: measurements verified against spec limits at entry; system
  computes in-spec % and flags high-risk lots; lot accept/reject follows the
  plan's accept number; Cp/Cpk-based lot acceptance offered as methodology.
- **Net-Inspect / High QA**: out-of-tolerance color coding at entry; live
  spec-limit display.
- **Rationale**: instant feedback prevents bad data and surprises, but
  disposition has business consequences (MRB, use-as-is, supplier chargeback)
  that need judgment and authority.

### 4. NCR born from the inspection, pre-populated

- **SAP**: rejecting a characteristic auto-creates a defect record (defect
  code per exceed-upper/below-lower/general, defect class critical/major/
  minor); every defect record is an inactive quality notification that
  activates automatically by defect class, manually, or implicitly. GR
  inspections typically activate a Q2 vendor complaint carrying defect items +
  lot/PO/vendor references.
- **1factory**: "Generate a non-conformance report from within an inspection
  with a single click… Autopopulate NCR details from Inspections." NCR → MRB
  disposition, → CAPA/SCAR (8D) chains.
- **ProShop**: NCR generation built into receiving; auto-linked to part, job,
  operator, inspection tool; **permission-tiered dispositions** (anyone can
  scrap obvious bad parts; use-as-is/rework requires QC/MRB).
- **Rationale**: re-keying failure data loses fidelity; the inspection already
  knows the item, supplier, PO, lot, failed characteristics, and measured
  values.

### 5. Execution UI: drawing + grid split view

- **1factory**: three data-entry layouts — Feature View, Parameter View,
  **Spreadsheet View** (characteristics × sample units); filter by operation,
  method, sampling rule; keyboard + digital gauge + CMM import entry.
- **High QA**: dual-pane drawing viewer beside the characteristic grid;
  operators "input measurement data digitally directly onto drawings"; also a
  wizard step-by-step mode for low-training operators.
- **DISCUS**: find-a-characteristic highlights the row in the BoC **and** the
  balloon on the drawing — the grid and drawing are a linked pair.
- **Rationale**: the balloon number is the shared key between the drawing and
  the grid; navigating either surface must move the other.

### 6. Stock is quarantined during inspection; disposition posts it

- **SAP**: GR posts to quality inspection stock (QM has exclusive control);
  the UD posts quantities — splittable across unrestricted / blocked / scrap /
  sample usage / new material / return-to-vendor, including per serial number.
- **Carbon today** (parity note): tracked entities post `On Hold` and are
  released by sample pass or lot disposition; non-tracked rejects post a
  compensating item-ledger adjustment.

## Answers to Research Questions

1. **Entities/lifecycle** — Inspection lot (created from goods receipt) →
   plan/characteristics assigned → sample sizes calculated → results recording
   (per characteristic, per sample unit) → characteristics closed/valuated →
   usage decision (coded, human) → stock posting + quality level update (SAP;
   1factory and High QA mirror this with lighter vocabulary: inspection lot,
   bill of characteristics, results, disposition).
2. **Sampling × characteristics** — measurement is recorded per sample unit ×
   per characteristic; sample size is derived per characteristic from its
   sampling rule + lot size (SAP, 1factory, High QA). Completeness gating:
   inspection cannot close until all required cells are filled (1factory).
3. **Out-of-tolerance roll-up** — reading auto-valuated fail; characteristic
   valuated by accept/reject numbers (attributive) or k-method (variable); lot
   disposition remains inspector judgment; auto-accept only for clean passes
   (SAP).
4. **NCR spawning** — both auto (by defect class / on rejection) and manual
   (one click from inspection or usage-decision screen); carries defect codes,
   counts, failed characteristics, lot/PO/supplier references (SAP, 1factory).
5. **Drawing + grid presentation** — split view with balloon↔row sync
   (High QA, DISCUS); out-of-tolerance color coding in the grid (Net-Inspect);
   entry modes: spreadsheet grid, per-feature wizard, on-drawing entry.
6. **Terminology** — inspection lot, characteristic (bill of characteristics),
   sample unit, results recording, valuation, usage decision / disposition,
   defect class, acceptance number (Ac/c) & rejection number (Re/d), skip-lot,
   normal/tightened/reduced switching, dock-to-stock, C=0.

## Competitor-Specific Details

### SAP QM
- Quality info record per material+vendor gates the relationship (skip GR
  inspection for certified vendors, source inspection at vendor, cert checks).
- Dynamic modification: quality level per material(+vendor) advances
  normal/tightened/reduced/**skip** stages by acceptance/rejection history.
- Recording forms per characteristic: summarized vs single values vs classed;
  single-value rows can bind to serial numbers.
- Characteristic control indicators worth borrowing: required vs optional,
  documentation-required-on-rejection (forced comment), destructive (drives
  sample-usage stock posting).

### 1factory
- Characteristic types: Variable (numeric), Attribute (pass/fail), Calculated.
- Per-feature sample-size enforcement gates inspection close.
- Lot switching (normal/reduced/tightened/skip-lot) is a data-assisted
  *decision* per part+supplier, not fully automatic; dock-to-stock candidates
  surfaced from history.
- Certificates (material certs, plating, heat treat) attach to the inspection
  lot; audit-readiness enforces required certs.

### High QA
- Batch automation mass-produces ballooned drawings + plans; 3D PMI extraction.
- Execution via browser/tablet apps (IM Explorer/eXpress): ballooned drawing +
  step-by-step wizard + direct on-drawing entry; live Cp/Cpk display.
- ERP integration pattern: ERP work order clones a template inspection job.

### ProShop / Fulcrum / Net-Inspect
- ProShop: permission-tiered dispositions (scrap = anyone; use-as-is/rework =
  MRB); NCR auto-linked to part/job/operator/gauge.
- Fulcrum: quality checkpoints as routing-step gates; certs attach to received
  lots and flow to jobs; NCR grid dashboard. No dedicated IQC module.
- Net-Inspect: AS9102 Form 3 per-characteristic accountability; reviewer UI
  with color-coded out-of-tolerance and field-level comments.
- C=0 plans (Squeglia): single table lot-size × AQL → n, accept on zero
  defects; simpler to administer/defend in audit than Z1.4 Ac/Re pairs; heavily
  used in medical/aerospace receiving. Tools model it as one selectable plan
  type alongside Z1.4/ISO 2859.

## Recommended Approach for Carbon

1. **Wire the two existing systems together, don't build a third**: the
   `inspectionDocument`/`inspectionFeature`/`balloon` tables already are the
   bill of characteristics (1factory/High QA pattern); the `inboundInspection`
   lot already is the SAP inspection-lot analog with an AQL plan snapshot. The
   redesign attaches the item's inspection features to the inbound lot and
   records measurements per sample × feature.
2. **Split-view execution screen** (High QA/DISCUS pattern): react-pdf drawing
   with balloon overlay on one side, editable results grid (inventory-count
   `EditableNumber` pattern) on the other; balloon click ↔ row focus sync;
   out-of-tolerance color coding at entry (Net-Inspect pattern).
3. **Auto-valuate readings, keep human disposition** (SAP pattern): a reading
   outside nominal±tolerance marks the cell/sample failed automatically;
   Accept/Reject/Partial lot disposition stays a button with authority attached
   — never auto-reject.
4. **Keep lot-level sampling in v1, structure for per-characteristic later**:
   Carbon's plan snapshot (sampleSize/Ac/Re on the lot) applies to every
   feature initially; the results table keys on (sample, feature) so
   per-characteristic sampling rules can be added without a rebuild — this is
   where SAP/1factory/High QA all end up.
5. **NCR pre-population from failed features** (1factory pattern): the reject
   flow already auto-creates an NCR; extend the payload with failed
   features/measurements so MRB sees what failed and by how much.
6. **Graceful degradation**: items with no inspection document keep today's
   pass/fail-per-sample flow — the characteristics grid is additive, not a
   prerequisite (matches how 1factory treats attribute-only plans).

## Sources

- https://download.consolut.com/direct/SAP_PrintDoku/en/QMIMIL/QMIMIL.PDF — inspection lot creation
- https://download.consolut.com/direct/SAP_PrintDoku/en/QMIMRR/QMIMRR.PDF — results recording & valuation
- https://download.consolut.com/direct/SAP_PrintDoku/en/QMIMDEF/QMIMDEF.PDF — defects recording / notification activation
- https://download.consolut.com/direct/SAP_PrintDoku/en/QMIMUD/QMIMUD.PDF — usage decision & stock postings
- https://download.consolut.com/direct/SAP_PrintDoku/en/QMPTBD/QMPTBD.PDF — MICs, sampling procedures/schemes, catalogs
- https://download.consolut.com/direct/SAP_PrintDoku/en/QMQCDYN/QMQCDYN.PDF — dynamic modification
- https://help.sap.com/docs/SAP_ERP/250374f0514e4e0f9057066374265eba/2514c453f57eb44ce10000000a174cb4.html — GR inspection
- https://www.1factory.com/incoming-quality.html — IQC features
- https://www.1factory.com/incoming-quality-control-iqc.html — IQC flow, skip-lot, dock-to-stock
- https://www.1factory.com/fai-ballooning-software.html — ballooning detail
- https://www.1factory.com/all-features.html — plan model, sampling standards, entry layouts, NCR/MRB
- https://www.1factory.com/ncr-capa-scar-complaint.html — NCR/CAPA/SCAR
- https://www.1factory.com/supplier-quality.html — supplier portal, SCAR 8D
- https://www.1factory.com/case-studies/orbit-irrigation.html — receiving case study
- https://highqa.com/ballooning-and-gdt-extraction/ — ballooning + BoC
- https://highqa.com/aql-sampling-plans/ — per-dimension AQL
- https://www.highqa.com/high-qa-software/ — end-to-end workflow
- https://www.highqa.com/production-data-collection/ — shop-floor execution
- https://www.highqa.com/inspection-explorer/ — browser execution app
- https://www.net-inspect.com/solutions/first-article-inspection-software/ — FAI results review
- https://proshoperp.com/blog/non-conformance-reports-can-positively-impact-your-shops-bottom-line/ — tiered dispositions
- https://fulcrumpro.com/manufacturing-software/shipping-receiving — receiving flow
- https://fulcrumpro.com/resources/as9100-requirements — checkpoint gates, certs
- https://www.qualitydigest.com/inside/operations-article/when-and-how-use-zero-acceptance-number-sampling-041119.html — C=0 vs Z1.4
- https://www.discussoftware.com/tips/find-a-characteristic/ — balloon↔row sync
- https://ifactoryapp.com/article/incoming-quality-control-software-supplier-inspection-management — per-characteristic auto-calculation
