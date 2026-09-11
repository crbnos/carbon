# How ERPs and QMSs Create a Customer Return Authorization from a Quality Record

**Date:** 2026-08-18
**Question:** When a nonconformance / customer complaint / warranty claim is registered against goods that are already **at the customer**, how do systems authorize getting those goods back — what triggers the return document, what data carries across, how are the two records linked, and what stops the quality record closing while the return is in flight?

Companion to `.ai/research/2026-08-07-rma-module.md`, which surveyed the RMA document itself. That research answered "what is a return authorization"; this one answers "what makes one appear from a quality record". Sources are official vendor documentation unless flagged. Epicor's Kinetic help remains behind a customer login (EpicWeb/doc.epicor.com), so Epicor claims here come from community-republished contextual help and are flagged **unverified**. Anything not verified against a primary page is marked.

---

## Oracle NetSuite — two distinct quality-record→RA bridges

NetSuite is the only surveyed vendor that ships **two** separate first-party paths from a quality-ish record to a return authorization, and the differences between them are instructive.

### 1. Return Authorization from Case (SuiteApp)

A support case is NetSuite's customer-complaint record. The SuiteApp "lets you create a return authorization or a replacement sales order directly from a support case record for existing sales orders or customer invoices" ([Return Authorization from Case Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156341956959.html)). The documented issue types it exists to serve are exactly the RMA reason vocabulary: **wrong item shipped, wrong invoice price, wrong quantity, damaged goods, product replacement**.

**The complaint is not the source of the line data — a transaction is.** The flow is: create the case → **Search Transaction** → pick a sales order or customer invoice → pick items and quantities → generate. "To create a return authorization or a replacement sales order based on a customer invoice or sales order, you must first search for the transaction record with the item or items for return or replacement" ([Using the SuiteApp](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_156349932827.html)). The case supplies the *reason to act*; the shipped/invoiced document supplies *what may come back*.

**Eligibility is filtered by transaction status**, not by case state:

| Type | Included | Excluded |
|------|----------|----------|
| Customer Invoice | Open, Pending Approval | Paid in Full, Rejected |
| Sales Order | Billed, Partially Fulfilled, Pending Fulfillment | Closed, Pending Billing, Canceled, Pending Approval |

**A returnable-quantity cap is enforced at selection time:** "In the Quantity field, enter the number of items for return or replacement. If you are creating a return authorization, the value should not exceed the amount specified in the **Returnable Quantity** column."

**Cardinality is strictly one-to-one, and enforced.** "You can generate a maximum of one return authorization and one replacement sales order per case record", and "You cannot choose a transaction if one of the same type is already linked to the case record." The SuiteApp maintains "a one-to-one relationship between the support case and the source sales order or customer invoice transaction."

**Linking is bidirectional and automatic.** "Ensure that the source transaction, its support case, and the generated return authorization or replacement sales order records are all linked together… The SuiteApp also automatically links these records." "The generated return authorization or sales order transaction now contains a link to the support case. The link to the created transaction record is also available on the case record."

The generated record "is set to Pending Approval and goes through standard NetSuite approval" — the bridge drafts, it does not authorize. Documented limits: promotions are unsupported on generated replacement orders, and ">500 line items may result to performance issues".

### 2. Return Authorizations for Warranty Claims

The warranty claim is a purpose-built quality record, and its bridge is tighter than the case bridge. From the claim record, **Create RMA** builds the RA with the Warranty Information section auto-filled: "These fields are filled in automatically with details from the claim and other related transactions" — Claim Number, Item, Serial/Lot Number, Action ([Creating Return Authorizations for Warranty Claims](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4391869751.html)).

Three constraints matter for design:

- **Serial identity is one-claim-one-unit.** "For serialized items, set the quantity to **1** because you can only process one claim per serial number."
- **The claim's data is frozen once an RMA exists.** "When a claim has RMA records, you can't edit certain fields in the Warranty Information section, and you can't delete the claim."
- **The RMA cannot drift from the claim.** "You shouldn't add, change, or remove warranty items on the return authorization. If the warranty items don't match the claim details, you can't submit the RMA." And "Manually attaching transaction records to an RMA isn't supported."

RAs are "linked and tracked on the warranty claim record… under the **Claim Transactions** subtab".

**Contrast worth carrying:** the *case* bridge is loose (one RA, free editing, cap only at selection); the *warranty claim* bridge is tight (identity-locked, edit-frozen, drift-rejected). The tighter bridge is the one attached to the record that carries serial identity.

## SAP — quality notification → returns order (the closest analogue)

SAP is the only surveyed system where the return document is created **from the nonconformance record itself** rather than from a CRM case, and it is explicit about which nonconformances qualify.

"You can use this function to create a returns order in Advanced Returns Management for quality notifications with the **origin Customer Complaint**" — notification type **Q1** in the standard system ([Integration of Quality Notification with Advanced Returns Management](https://help.sap.com/doc/f9840c536372b40ce10000000a44176d/700_SFIN20%20006/en-US/b5140b5565faf857e10000000a441470.html)). The bridge is implemented as three follow-up functions in the notification's action box: **Create Returns Order**, **Display Returns Order**, **Display Returns Overview**.

Two design points:

1. **The trigger is the notification's origin/type, not a disposition code.** Q1 ("a problem involving poor-quality goods or services delivered to a customer" — [Customer Complaint](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/2bc3ee8d1c83404e8cf62418640004f2/046db6535fe6b74ce10000000a174cb4.html)) is a *classification of the record*, established at registration. SAP does not require the quality analyst to first disposition the material — which would be incoherent, since the material is at the customer.
2. **Linkage is via document flow, in both directions.** "The quality notification is visible in the document flow of the returns order in Advanced Returns Management and is also displayed in the returns overview" — plus the notification-side *Display Returns Order* function.

Availability is gated on business functions `OPS_ADVRETURNS_1` / `OPS_ADVRETURNS_2` and Customizing must make the follow-up functions available "for the relevant notification types". SAP Complaint Handling (the newer product) markets the same principle: it "links all the aspects of complaints — Quality, Finance, and Logistics in one place" ([Feature Scope Description](https://help.sap.com/doc/d540b2918a9549fd81888dd68785559d/SHIP/en-US/FSD.pdf)).

**SAP Business One** is a step down: it has a **Return Request** authorization document ahead of the Return, but no native nonconformance record to bridge from ([Return Request](https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/2568acf109b0414392e4f928751e50e3.html) — page content not retrievable at time of writing, **unverified**; the document's existence is corroborated by the prior research).

## Infor CloudSuite Industrial (SyteLine) — QCS directs the RMA receipt into quality

Infor runs the relationship in the **opposite** direction from SAP, and is worth reading as the counter-example.

RMA is the sales-side document: "Return Material Authorization (RMA) is the process used to track the return of damaged or defective products from customers and the issuance of credit, replacement, or repaired material as recompense", with four ordered steps — create RMA header → create RMA line items → receive (via the **RMA Return Transaction** form) → repair/rework ([RMA Steps](https://docs.infor.com/csi/9.01.x/en-us/csbiolh/lsm1454144038357.html)). Notably, that page documents no quality integration at all beyond obsolete/slow-moving warnings.

The quality tie-in lives in the separate **Quality Control Solution (QCS)** module: when customers return products, QCS works with the RMA module to **direct that product to QC for receipt, inspection, disposition, and non-conformance tracking** (vendor/partner descriptions — [Godlan QCS overview](https://www.godlan.com/qcs-infor-syteline-quality-control-solution/), Infor CloudSuite marketing pages; the Infor training workbook PDF was not machine-readable, so this is **unverified** against primary docs). QCS separately offers **Customer Complaint Reporting (CCR)** to "respond to feedback from your customers, assign responsibility, track your internal review and corrective action, and to measure customer satisfaction" — but the documented direction is complaint-and-inspection *following* the RMA, not the RMA being drafted from the complaint.

## Epicor Kinetic — RMA disposition is the bridge, and it points at the supplier

Epicor's customer-return flow places the quality decision *after* receipt: an RMA receipt lands in inspection, and **RMA Disposition** routes each unit to Stock, a Job, **Fail (DMR)**, or Return Shipment. Community-republished contextual help notes that "RMA Disposition can be used to process a DMR or supplier return without the QA module", and that FIFO layers "returned from RMA Disposition to Job or Fail (DMR) will be processed as individual or distinct FIFO layers during DMR Processing" ([epiusers.help thread](https://www.epiusers.help/t/how-do-i-process-a-supplier-return-dmr-via-rma-disposition-without-the-qa-module/67390), [10.1.500 feature summary](https://tomerlin-erp.com/wp-content/uploads/2017/01/Epicor10_FeatureSummaryHighlights_101500.pdf) — both **unverified** against Epicor primary docs, which are login-gated).

So Epicor's documented quality↔return bridge is **customer return → nonconformance (DMR) → supplier return** — precisely the direction Carbon already implements. The reverse (nonconformance → customer RMA) is not documented in reachable Epicor material; community threads on "RMA Return to Customer" note thin documentation for adjacent scenarios ([thread](https://www.epiusers.help/t/rma-return-to-customer/126348)).

## Microsoft Dynamics 365 Business Central — no nonconformance record to bridge from

BC has a full sales return order with exact cost reversing, return reason codes, and **Create Return-Related Documents** (which spawns a replacement sales order, a purchase return order, and/or a replacement purchase order in one action — the documented use case being vendor-warranty items) — all covered in the prior research. What BC does **not** have is a native nonconformance/complaint object in base application; quality management is an ISV extension surface. There is therefore no first-party quality-record→RMA bridge to cite. BC's relevance here is the *inverse* pattern: its one-action fan-out from a return document to related documents shows that "one gesture drafts the follow-on document, pre-filled and still editable" is the expected ergonomic.

## Odoo 18 — the negative case, again

Odoo's quality alert is created from manufacturing orders, inventory transfers (receipts, deliveries), the Shop Floor module, or directly in the Quality app, and captures product, work center, picking, responsible, priority, root cause, and corrective/preventive action tabs ([Quality alerts](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/quality/quality_management/quality_alerts.html)).

**The documentation describes no mechanism for a quality alert to generate a return, an RMA, or a repair order.** Returns remain a reverse transfer created from the delivery order, and repairs a separate Repairs app record created independently ([Process repair orders](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/repairs/repair_orders.html)). Every RMA-with-claims capability in the Odoo ecosystem is third-party (`warranty_claim_return_rma`, `sync_helpdesk_rma`, `quality_control_capa` on the Apps Store) — which is itself the finding: the gap is real enough that the community fills it repeatedly.

## ISO 9001:2015 — why the link has to exist at all

Two clauses put the bridge in scope for any QMS-bearing ERP:

- **8.7 Control of nonconforming outputs** requires that nonconforming outputs "are identified and controlled to prevent their unintended use or delivery", with action taken "appropriate to the nature of the nonconformity and its effect". Product already delivered to a customer is squarely in scope — recovering it is a control action.
- **10.2 Nonconformity and corrective action** treats **customer complaints** as a first-class trigger for corrective action, alongside audits and internal observation, and requires root-cause determination and effectiveness evaluation.

The practical consequence for a data model: the complaint, the physical recovery of the goods, and the corrective action are **one causal chain and should be one auditable record trail**. A design that spawns a second, unlinked nonconformance when the returned goods are finally inspected breaks the 10.2 trail exactly where an auditor looks for it. (Clause text as summarized by [isms.online](https://www.isms.online/iso-9001/clause-8-7-control-of-nonconforming-outputs/) and [Core Business Solutions](https://www.thecoresolution.com/clause-8-7-iso-90012015-explained); the standard itself is paywalled — **unverified** against ISO's own text.)

---

## Synthesis

### The common core

1. **The trigger is the record's classification or lineage — never a material disposition.** SAP keys on notification origin (Q1 Customer Complaint). NetSuite keys on the case existing plus a selectable source transaction, or on a warranty claim. Nobody requires the quality analyst to disposition the material first, because the material is at the customer and there is nothing on hand to disposition. This is the sharpest divergence from the *supplier*-return bridge, where a disposition of held stock is exactly the right trigger.
2. **The quality record supplies the reason; a shipped/invoiced document supplies the returnable quantity.** NetSuite makes this literal — the case cannot produce an RA until a sales order or invoice is selected, and the cap is that document's Returnable Quantity column. The complaint says *that* something is wrong; the outbound document is the only thing that knows *how much may legitimately come back*.
3. **The bridge drafts; it does not authorize.** NetSuite's generated RA is Pending Approval. SAP creates a returns order that then runs the normal ARM lifecycle. The gesture saves typing and guarantees linkage — it does not skip the return document's own controls.
4. **Linkage is bidirectional and machine-maintained.** SAP puts the notification in the returns order's document flow *and* gives the notification a Display Returns Order action. NetSuite writes a link onto both the case and the transaction, automatically. In every case the reviewer can start from either end.
5. **Re-invocation is bounded.** NetSuite enforces it structurally — one RA and one replacement SO per case, and a transaction already linked to the case cannot be chosen again. Something must stop one complaint authorizing the same units twice.
6. **The stronger the identity on the quality record, the tighter the bridge.** NetSuite's warranty claim carries a serial number, so its RMA is edit-frozen and drift-rejecting ("if the warranty items don't match the claim details, you can't submit the RMA"), while the serial-free case bridge stays freely editable.

### Divergences worth noting

- **Direction.** SAP and NetSuite run quality → return. Epicor and Infor run return → quality (RMA receipt lands in inspection; disposition may then spawn a supplier DMR). These are complementary, not competing — a mature system has both, and Carbon currently has only the second.
- **Where the complaint lives.** SAP uses the quality notification itself (Q1). NetSuite uses a CRM support case, separate from quality. Infor has a dedicated CCR record inside QCS. The bridge design does not depend on which, only on whether the record can resolve to a customer.
- **Cardinality.** NetSuite hard-caps at one RA per case. SAP documents no such cap. A hard cap is simple but wrong for a complaint that turns out to span two shipments; per-quantity coverage accounting is the more general answer.
- **Nothing surveyed documents a close guard.** No vendor states that the quality record cannot be closed while the return is in flight. This is a genuine gap in the surveyed material — Carbon's own supplier-return bridge already implements such a guard, so the precedent is internal, not external.

### Implications for Carbon

1. **Trigger on customer lineage, not on a `disposition` value.** Carbon's `disposition` enum dispositions stock the company *holds* — `closeIssue` turns every `Scrap` / `Return to Supplier` row into a negative `itemLedger` movement. A "get it back from the customer" disposition would have to be carved out of that builder as a special case that moves no value, which is a strong signal it does not belong in that enum. SAP's Q1-origin trigger and NetSuite's case-plus-transaction trigger both key on classification/lineage instead. Carbon already has the lineage: `nonConformanceCustomer`, `nonConformanceSalesOrderLine`, `nonConformanceShipmentLine`.
2. **Reuse `getReturnableLinesForCustomer` as the cap.** Finding 2 says the outbound document owns the returnable quantity, and Carbon's returns module already ships exactly that query (posted shipments for the customer, minus already-authorized/returned). The bridge should *select* through it, not invent a second cap — which also means the concurrency-safe transactional cap already specced for the RMA covers the bridge for free.
3. **Per-quantity coverage beats NetSuite's one-per-case cap.** The supplier-side bridge already established this shape in Carbon (`nonConformancePurchaseReturnOrderLine.quantity` + idempotent re-invocation). The existing `nonConformanceSalesReturnOrderLine` junction has no `quantity` column because the RMA→Issue direction never needed one; the reverse direction does.
4. **Close the loop rather than spawning a second Issue.** ISO 10.2 wants one corrective-action trail per complaint, and NetSuite's warranty-claim bridge shows the tight-coupling instinct. Carbon's existing RMA line escalation (`$id.$lineId.issue.tsx`) unconditionally creates a *new* Issue — correct for a blind return, wrong for a return that an Issue authorized in the first place. When the RMA carries an origin Issue, the disposition and its received tracked entities belong on that Issue.
5. **Keep the close guard, drop the write-off arithmetic.** The supplier bridge needed both a guard and a write-off reduction because a return *shipment* relieves inventory the Issue would otherwise write off — a genuine double-relief hazard. The customer direction has no such hazard: the RMA receipt *adds* inventory. The guard survives for a different reason — closing an Issue while the goods that would prove its disposition are still in transit is premature, and it is the only thing preventing a `Scrap` row from writing off stock that has not arrived.
6. **Bridge to a draft, then get out of the way.** Every surveyed implementation pre-fills and hands off to the return document's own lifecycle. Carbon's RMA already owns confirm, PDF, receiving, disposition, credit, and replacement — including `Create Replacement Order`, which is why a *separate* Issue→replacement-order path (NetSuite's second SuiteApp mode) would be a second road to a document the RMA already reaches.
