# Certificate of Conformance Research: Best Practices Survey

## Summary

This survey covers how ERPs, quality tools and customer quality standards handle an **outbound** Certificate of Conformance (CoC). A CoC is a signed statement from Carbon's user to their customer. It states that the parts in a shipment conform to the purchase order, the drawing and the specifications. In the leading products the CoC hangs off the **shipment / packing slip** and covers the quantity actually shipped. The CoC has one section per line (ProShop, E2, SAP per delivery item).

Products make a CoC **required** at customer level, part level, or both. ProShop lets the part override the customer, and the shipment document can override either one. AS9100 / ISO 9001 clause 8.6 turns the CoC from a PDF into a **release record**. The release record needs evidence of conformity and a named person who authorized release. Customer flowdowns (Lockheed QX, Boeing, RTX) agree on a minimum field set:

- part number + revision, quantity, PO number, lot / serial traceability
- deviations, an **unqualified** statement
- the authorized quality representative's printed name, title, signature and date

Where a product generates a CoC at all, it renders the CoC from a live template at print time. Only SAP stores the CoC as an output record. Few products treat the CoC as a stored, signed document with its own status, so Carbon can fill this gap. Carbon already has nearly every input. The inputs are shipments with lot / serial tracking, customer PO, item revision, the document template customizer and the generate-and-attach + email pattern. Carbon has no signature, no CoC flag and no certificate entity.

## Competitors Surveyed

- **SAP S/4HANA QM (QM-CA)** — the enterprise reference. Quality certificates per delivery item, with determination by profile.
- **ProShop ERP** — the best-documented job-shop CoC. Packing-slip and work-order variants, a configuration hierarchy, and a signer tied to final inspection.
- **ECI E2 Shop / JobBOSS²** — the common job-shop baseline. A customer flag drives cert printing with the packing list.
- **Epicor Kinetic** — discrete manufacturing. No native CoC; shops build custom reports. This shows the demand.
- **Fulcrum** — a modern job-shop ERP. Certifications PDF at shipping, in-app e-signing, customer-format templates.
- **Paperless Parts** — CNC / quoting. A company-wide conformance statement and a per-order CoC download.
- **Plex, Global Shop Solutions, NetSuite, MRPeasy** — light or unverified coverage (see details).
- **1factory, High QA, Net-Inspect, ETQ** — quality point solutions. They are mostly inbound or report-oriented, and none authors outbound CoCs as a first-class object.
- **Standards / customer requirements** — AS9100D 8.6, ISO 9001:2015 8.6, FAR 52.246-15, DFARS 252.246-7007/7008, EN 10204, Lockheed Martin Appendix QX, Boeing, RTX flowdowns.

## Key Consensus Patterns

### 1. The CoC is keyed to the shipment, one section per line

- **SAP**: SAP creates the certificate per **outbound delivery item** (QC20, or output from the delivery). When there is no delivery, SAP can also create it per inspection lot (QC21) or batch (QC22).
- **ProShop**: The packing-slip CoC covers the delivered quantity, so partials and overages are right. "Show/Print All" prints one page per packing-slip line. A work-order CoC covering the whole lot exists as a second variant.
- **E2 / Epicor / Fulcrum**: These print with, or straight after, the packing list.
- **Paperless Parts**: Per order. This is the outlier.
- **Lockheed QX §1.5**: "one CoC per shipment".
- **Rationale**: The customer receives a shipment. Quantities and lots must match the contents of the box, not the customer's order.

### 2. "CoC required" is set at customer, then part, and can be overridden on the shipment

- **SAP**: SAP assigns a certificate profile by Material+Customer, else Material, else Material group (QC15). Output condition records decide the recipient and medium per customer.
- **ProShop**: The hierarchy is global → contact → part → packing slip → packing slip line. Part beats contact.
- **E2**: A customer "Print Certifications" flag flows to orders and packing lists, and can be overridden on the packing list.
- **Epicor (custom)**: A part-level or customer-level checkbox.
- **Rationale**: Aerospace and defense customers require a CoC on everything. Commercial customers want one only for certain parts.

### 3. The signatory is a named, authorized quality person, ideally tied to a release event

- **SAP**: The certificate document has no sign-off. Approval sits upstream, in the usage decision with QM digital signatures, and the form prints the signature line.
- **ProShop**: The signer and date come from whoever checked "Certified to Run" on the Final Inspection operation.
- **Fulcrum**: In-app e-signing ("Sign" toggle) replaced print, hand-sign and scan.
- **AS9100 / ISO 9001 8.6**: Retained information must include traceability to the person authorizing release.
- **Lockheed / Boeing / RTX**: The signature and title of the authorized representative, with the printed name next to it. An e-signature is acceptable.
- **Rationale**: Without a named authorizer, a CoC is just marketing copy. The authorizer is what the auditor checks.

### 4. A standard, unqualified statement, with a customer-specific override

- **Paperless Parts**: One company-wide conformance statement.
- **Fulcrum**: Customer-supplied CoC templates whose fields map to data.
- **SAP**: Texts on the form; a separate profile per customer when wording differs.
- **RTX**: Forbids qualifiers such as "to the best of our knowledge".
- **Rationale**: Most shops use one statement. A minority of customers impose their own wording.

### 5. The CoC is the declaration; the evidence travels with it

- **ProShop / Fulcrum / Global Shop**: A cert package of the CoC + FAI + material certs + drawings.
- **High QA / Net-Inspect**: AS9102 FAI Form 2 (material & process certs) and inspection reports, delivered alongside.
- **SAP**: SAP prints characteristic results from usage-decided inspection lots or batch classification on the certificate itself.
- **Rationale**: Customers ask for "the cert pack". The CoC lists the attachments.

### 6. Delivered with the packing slip, retained as a record, reprintable

- **SAP**: Output by print, email or EDI (QCERT IDoc), archived through ArchiveLink, reprinted by repeat output.
- **ProShop / E2 / Fulcrum**: Printed at shipping, with reprint from the packing slip.
- **Lockheed**: A copy goes in the box. Lockheed requires the supplier to keep records 3 years after final payment (7 years for special processes). Common subtier flowdowns require 10 years.
- **Rationale**: The CoC must match what shipped at that moment. Re-rendering a live template later can drift, for example after a name or statement edit.

## Answers to Research Questions

1. **What triggers a CoC, and what is it keyed to? One per shipment or per line?**

   The shipment triggers the CoC and keys it (SAP's delivery, or the packing slip). Products make one document per shipment, with a section or page per line. SAP uses one section per delivery item, ProShop one page per packing-slip line, and Lockheed one CoC per shipment. Products print or issue the CoC at shipping. A work-order/lot CoC is a secondary variant (ProShop).
2. **What content is standard?** — Canonical minimum, merged from Lockheed QX, FAR 52.246-15, RTX and Boeing:
   1. certificate number and date
   2. seller name and address, plus the manufacturing site if different
   3. customer name and PO number (+ line)
   4. shipment / packing slip number, carrier / bill of lading
   5. part number **and revision**, description, customer part number
   6. quantity + unit of measure
   7. lot / heat / serial / date code
   8. specifications and drawings with revisions
   9. deviations / waivers, or "None"
   10. special handling / shelf life
   11. list of attachments
   12. an unqualified conformance statement
   13. the authorized representative's printed name, title, signature and date
   14. a counterfeit-parts statement when DFARS 252.246-7007/7008 applies

   **Correction to the brief:** DFARS 252.246-7000 is the receiving report (DD250 / WAWF), not a CoC clause. The federal CoC clause is FAR 52.246-15.
3. **How is it approved and signed?** — Named authorized quality personnel (AS9100 8.6). Products either tie the signer to a final-inspection sign-off (ProShop) or e-sign at issue (Fulcrum). SAP puts approval upstream in inspection and the usage decision. Lockheed and Boeing accept an e-signature. None of the surveyed products documents a multi-step approval workflow on the CoC.
4. **Are there per-customer templates or statements, and is a CoC required per customer or per item?**

   Products set the requirement per customer and per part (ProShop, E2, SAP). The part overrides the customer, and the shipment can override both. The statement is mostly one per company (Paperless Parts). Per-customer wording or format exists in SAP (profile per customer) and Fulcrum (uploaded templates). No product has a verified per-customer statement field.
5. **How does it link to inspection results, material certs and traceability?** — SAP prints inspection-lot or batch characteristic values. ProShop and Fulcrum bundle FAI and material certs into a package. Lot and serial numbers come from the shipped lots. Under DFARS 7008, the contractor must keep traceability to the original manufacturer for electronic parts.
6. **How is it delivered, stored and reissued?**

   ProShop, E2, Epicor and Fulcrum print the CoC with the packing slip, or right after it. Paperless Parts offers a download per order. SAP also emails it or sends it by EDI, and archives it through ArchiveLink. Lockheed requires a copy in the box. SAP and ProShop reprint it. The customer sets the retention period (3, 7 or 10 years).

## Competitor-Specific Details

### SAP S/4HANA QM

- Terminology: **quality certificate**, **certificate profile** (QC01, needs a release), **certificate type** (QM01 / E23), **certificate recipient** (output condition record).
- Determination: QC15 / QC16 by Material+Customer → Material → Material group, with date validity.
- Output:
  - Classic: LQCA (ship-to) / LQCB (sold-to) at delivery item level, form QM_QCERT_01.
  - S/4 output management: QUALITY_CERTIFICATE on OUTBOUND_DELIVERY_ITEM.
  - EDI: QCERT / QALITY02.
- Content comes from usage-decided inspection lots, batch characteristics, or production-chain components through the batch where-used list. Only master inspection characteristics can print.
- No approval on the certificate itself. SAP can also publish batch certificates for customers to download (QM-CA-CG).

### ProShop ERP

- Two full-page CoC types: work-order (whole lot) and packing-slip (delivered quantity, one page per line).
- Configuration hierarchy: global → contact → part → packing slip → packing-slip line.
- The signature and date come from the "Certified to Run" checkbox on the Final Inspection operation. There is a signatures setup.
- Marketing: a document package with the CoC, FAI, certs and ballooned drawings.

### ECI E2 Shop / JobBOSS²

- E2: a customer "Print Certifications" flag flows to orders and packing lists, and can be overridden manually. Certifications have their own print forms. Outside-service "Certifications Required" spools a certification print.
- JobBOSS²: a material "Certification Required" checkbox and a "Certifications With Packing List" setting. Users store certs outside the system. There is no documented native generated CoC.

### Epicor Kinetic

- No native CoC. "Shipping Docs Required" only checks that an attachment of a document type exists on the lot (an empty file passes).
- Shops add custom part or customer checkboxes that print a CoC after the pack slip. Other shops add a CoC block with a quality signature line on the packing slip itself.

### Fulcrum

- A "Certifications" button next to "Pack List" when shipping makes a PDF for the sales order. Jobs have a Certs tab, and lot certs roll up as the shop picks materials.
- Newer features: an in-app **Sign** toggle, and uploaded customer CoC PDF templates (Quality → Templates). Users map each template field to a data source, manual entry, signature, date or checkbox.

### Paperless Parts

- A company-wide conformance language setting. Users download the CoC per order from the order details page.

### Plex / Global Shop / NetSuite / MRPeasy (light)

- Plex: a third-party review claims automated CoC/CoA at shipment with digital signatures (unverified).
- Global Shop: material cert packs printed at shipping (marketing only).
- NetSuite: no native CoC; quality SuiteApps make Certificates of **Analysis**.
- MRPeasy: attaches supplier certs to lots, with no CoC generation.

### Quality point solutions

- 1factory: inbound supplier cert management by lot.
- High QA: AS9102 FAI forms and inspection reports.
- Net-Inspect: Boeing FAI submission, customer visibility of "shipment documentation".
- ETQ Reliance: emails an "inspection certificate" when an inspection completes and conforms. This is the closest inspection-gated issue pattern found.
- None authors an outbound CoC with its own approval.

### Standards / flowdowns

- **AS9100D / ISO 9001 8.6**:
  - No release until the planned arrangements are complete.
  - Retain evidence of conformity and traceability to the person authorizing release.
  - Documents that must accompany the product must be present at delivery.
- **FAR 52.246-15**:
  - Required contents: date, contractor, supplies, contract number, carrier and bill of lading.
  - Fixed statement: "are of the quality specified and conform in all respects with the contract requirements, including specifications, drawings, preservation, packaging, packing, marking requirements, and physical item identification (part number)".
  - Signed, attached to the receiving report, with a copy in the shipment.
- **Lockheed QX rev 10 §1.5**: The most explicit field list (see Answer 2). One per shipment, with an e-signature accepted. Lockheed accepts FAA 8130-3 and EASA Form 1 as equivalents.
- **Boeing**: Requires a CoC "signed by an authorized agent of the Seller" with the invoice or packing sheet (X31764 rev 5; D6-87282 supersedes D6-82479).
- **RTX flowdowns**: No qualifying statements. Raw-material certs must show actual values and match part number + revision.
- **EN 10204 2.1 / 2.2 / 3.1 / 3.2**: Material cert types, usually attached rather than issued by the shop.
- **DFARS 252.246-7007 / 7008**: Counterfeit electronic parts. Requires traceability to the original manufacturer and flows down to subcontracts.

## Carbon starting point (codebase)

- **Shipment**:
  - Tables `shipment` / `shipmentLine` (status Draft / Pending / Posted / Voided, `sourceDocument` includes Sales Order).
  - `packages/server-functions/src/post-shipment` posts it.
  - Routes in `apps/erp/app/routes/x+/shipment+/`.
- **Packing slip PDF**:
  - Route `apps/erp/app/routes/file+/shipment+/$id[.]pdf.tsx`.
  - Renderer `packages/documents/src/pdf/PackingSlipPDF.tsx`, with blocks under `pdf/blocks/packingSlip/`.
  - It renders through the document template customizer (`documentTemplate`, `packages/documents/src/template/schema.ts` has 9 types; a new type needs `BLOCK_META` + `DEFAULT_TEMPLATES`).
- **Lot / serial**:
  - `trackedEntity`. The `attributes` keys `Shipment` / `Shipment Line` attach it to shipment lines.
  - `getShipmentTracking` / `getShipmentLineTracking` (`inventory.service.ts`) read it.
- **PO and revision**:
  - Customer PO is `salesOrder.customerReference`.
  - The revision is on the item (`item.revision`, one item row per revision).
  - Customer part number is `customerPartToItem`.
- **Inspections**:
  - `inspection` has `sourceDocument` = Receipt or Job Operation, plus `dispositionedBy` / `dispositionedAt`.
  - There is no outbound or final inspection tied to a shipment, and no certificate concept anywhere.
- **Signatures**:
  - None exist for users or employees.
  - `itarCertification` (full legal name, title, doc hash, IP, certifiedAt) is the closest attestation pattern.
- **Attach + email**:
  - `generateAndAttachSalesOrderPdf` + `upsertDocument` + `sendSalesOrderEmail` in `apps/erp/app/modules/shared/shared.server.ts`.
  - `customer.defaultCc` / `companySettings.defaultCustomerCc` supply the CC lists.

## Recommended Approach for Carbon

1. **A CoC per shipment, one section per shipment line, covering shipped quantity and the lots / serials actually shipped.** This follows SAP (delivery item), ProShop (packing slip) and Lockheed QX. Scope v1 to Sales Order shipments. A work-order/lot CoC (ProShop's second variant) is deferred.
2. **The requirement is resolved customer → item, with item overriding customer and an override on the shipment.** This follows the ProShop hierarchy, the E2 customer flag and SAP Material+Customer determination. At minimum, the shipment shows "CoC required" and the post flow warns or blocks when it is required and missing. Whether to block or warn is a spec decision.
3. **Store the CoC as a record, not only a live render.** The record has a unique number, an issued date and a status (Draft → Issued → Voided). It also has a signatory snapshot (user, printed name, title, signed-at). Carbon attaches a frozen PDF of it to the shipment (`document` table). This follows AS9100 8.6 (traceability to the person authorizing release) and SAP's archived output. It also avoids the drift that pure re-rendering suffers. The `itarCertification` table already shows the attestation shape (legal name, title, hash, timestamp).
4. **Signing is an authorized-user e-signature at issue.** Gate it with a permission (for example quality `update`) plus a typed full name / title. Do not tie it to an inspection event in v1, because Carbon has no outbound/final inspection keyed to a shipment. This follows Fulcrum's in-app signing, which Lockheed and Boeing accept. The ProShop pattern takes the signer from the final inspection sign-off. It is a later layer, once Job Operation inspections can feed it.
5. **One default unqualified statement per company, with an optional per-customer override, and merge fields for PO / part / revision.** This follows Paperless Parts plus SAP's per-customer profile. Render through the existing document template customizer as a new `certificateOfConformance` document type, so layout and branding come for free. Ship a default statement modelled on the commercial AS9100 wording, with no "best of our knowledge" qualifiers (RTX).
6. **Content v1** — every canonical field that Carbon already has:
   - certificate number and date
   - company name and address
   - customer and customer PO (`customerReference`)
   - shipment number and tracking number
   - part number + revision + description + customer part number
   - quantity + unit of measure
   - lot / serial numbers
   - the statement
   - the signatory block

   Deviations (NCR concession link), specification / drawing lists, a counterfeit-parts statement and attached cert packages (material certs, inspection reports) are follow-ups. Pattern 5 says customers value the package, but Carbon has no material-cert entity yet.
7. **Delivery: download / print from the shipment, attach the frozen PDF to it, and optionally email it to the customer.** This reuses `generateAndAttach*` / `send-email`. Reprint returns the stored PDF. Voiding a shipment voids its CoC.

### Unanswered (carry into the spec's Open Questions)

- Block posting vs. warn when a CoC is required and not yet issued.
- Whether the CoC must be issued before the shipment is posted (Lockheed's "copy in the box" implies yes) or can be issued after.
- Whether a CoC is a commercial (`packages/ee`) feature or community.
- Retention: Carbon does not delete documents, so a configurable retention period is probably moot. Confirm.
- Signature image vs. typed name only.

## Sources

- https://www.testingbrain.com/sap/qm-tutorial/qc15-tcode-in-sap.html
- https://www.testingbrain.com/sap/qm-tutorial/qc16-tcode-in-sap.html
- https://sapbrainsonline.com/qm-tutorial/qc21-tcode-in-sap.html
- https://www.testingbrain.com/sap/qm-tutorial/qc22-tcode-in-sap.html
- https://sapinsider.org/how-to-create-outgoing-quality-certificates/
- https://learning.sap.com/courses/applying-sap-s-4hana-quality-management/processing-quality-certificates_b8482f42-b266-4603-9653-a9081f42c53e
- https://help.sap.com/docs/SAP_ERP/250374f0514e4e0f9057066374265eba/4f6eb6531de6b64ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/2bc3ee8d1c83404e8cf62418640004f2/b46eb6531de6b64ce10000000a174cb4.html
- https://help.sap.com/doc/saphelp_nw70/7.0.12/ja-JP/04/964e38533e3860e10000009b38f889/content.htm
- https://help.sap.com/docs/SAP_ERP/250374f0514e4e0f9057066374265eba/c66eb6531de6b64ce10000000a174cb4.html
- https://www.erpgreat.com/qm015.htm
- https://community.sap.com/t5/enterprise-resource-planning-q-a/s4hana-outbound-delivery-note-using-new-output-management/qaq-p/602241
- https://userapps.support.sap.com/sap/support/knowledge/en/2805020
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/digital-signature-in-sap-qm-result-recording/ba-p/13579861
- https://dhelp-f4b211c7-65b6-4a56-a690-67f58ddac296.adionsystems.com/docs/doku.php?id=help%3Amodules%3Apackingslips%3Amodule_help%3Afull_page_cofc%3Astart
- https://proshoperp.com/blog/achieving-full-traceability-shop-floor/
- https://client.shoptech.com/faq/Enterprise/Manuals/User_Guide.pdf
- https://ideas.jobboss.com/ideas/JBCORE-I-128
- https://ideas.jobboss.com/ideas/JBCORE-I-2225
- https://www.epiusers.help/t/shipping-docs-required/117092
- https://www.epiusers.help/t/how-to-automatically-print-an-additional-specific-report-when-the-packing-list-is-printed/72007
- https://fulcrumpro.com/product-update/print-certifications-when-shipping
- https://fulcrumpro.com/product-updates?ddcf7c2e_page=3
- https://help.paperlessparts.com/s/article/company-settings
- https://www.erpresearch.com/erp/plex/quality-management
- https://www.globalshopsolutions.com/shipping-software-for-manufacturing
- https://www.suiteapp.com/blendAPPS-Quality-Control
- https://www.mrpeasy.com/resources/inventory/
- https://www.1factory.com/pricing.html
- https://www.1factory.com/incoming-quality.html
- https://www.1factory.com/industries/aerospace-quality.html
- https://highqa.com/first-article-inspection/
- https://highqa.com/inspection-manager-360-core/
- https://www.net-inspect.com/solutions/supply-chain-visibility-software/
- https://www.net-inspect.com/customers/
- https://images.harborfreight.com/hftweb/global-sourcing/ETQ%20Reliance%20Vendor%20User%20Guide(English).pdf
- https://www.fictiv.com/articles/certificate-of-conformance
- https://www.acquisition.gov/far/52.246-15
- https://www.acquisition.gov/far/46.315
- https://farclause.com/FARregulation/Clause/DFARS252.246-7000_Basic-material-inspection-and-receiving-report
- https://www.acquisition.gov/dfars/252.246-7008-sources-electronic-parts.
- https://www.wilkshireconsulting.com/single-post/iso-9001-8-6-release-of-products-and-services
- https://elsmar.com/elsmarqualityforum/threads/as9100d-clause-8-6-documentation-required-to-show-evidence-of-conformity.85321/
- https://www.testcert.co/standards/en-10204
- https://blog.projectmaterials.com/epc-projects/testing-inspection/mill-test-certificates-3-1-2/
- https://www.lockheedmartin.com/content/dam/lockheed-martin/aero/documents/scm/Quality-Requirements/Quality-Appendices/AppQX_rev10.pdf
- https://www.boeingsuppliers.com/content/dam/boeing/boeingsuppliers/boeing-suppliers/becoming/quality/X31764_Revision_5_Jan_2026.pdf
- https://www.boeingsuppliers.com/content/dam/boeing/boeingsuppliers/boeing-suppliers/becoming/quality/D6-87282_Rev_G.pdf
- https://www.boeingsuppliers.com/content/dam/boeing/boeingsuppliers/boeing-suppliers/becoming/terms/dac/6xxx.pdf
- https://www.gknaerospace.com/media/3amfpniw/raytheon-mk30-canister-program.pdf
- https://vertical-aerospace.com/wp-content/uploads/2023/11/Supplier-Quality-Requirements-1.pdf
