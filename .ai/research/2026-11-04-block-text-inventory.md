# Block text inventory — document templates

Research for `.ai/specs/2026-11-04-editable-block-content.md`. Read-only survey of
every user-visible string hard-coded inside the block-driven PDFs, what the
editor lets a user change today, and how templates are validated and filled.

Paths: `B/` = `packages/documents/src/pdf/blocks/`, `C/` = `packages/documents/src/pdf/components/`,
`S` = `packages/documents/src/template/schema.ts`, `D` = `template/defaults.ts`, `M` = `template/merge.ts`.

## Headline findings

1. Every section heading, column header, field label and empty-state text in the 12
   block PDFs is a JSX literal, English only. No Lingui anywhere in
   `packages/documents/src/{pdf,template,zpl}`; `locale` only formats numbers and dates.
2. Editable today: summary `taxLabel`, approval `heading` + caption, terms `content`,
   label `label` (Rev/Qty/S/N/Batch), and the authored extension blocks (richText,
   keyValue, field, spacer, shared, customField label, watermark).
3. Strings are copy-pasted per document, not shared: "Terms & Conditions" ×6,
   "Notes"/"None" ×6, "Subtotal"/"Shipping"/"Total" ×4, line-item columns ×4–8.
   Shared components (Header, Note, Summary) take text from callers; nothing centralizes labels.
4. Bugs found:
   - Quote summary prints a fixed "Taxes" and ignores `taxLabel` (`B/quote/registry.tsx:28` doesn't pass `block`), yet the editor shows the field.
   - PO summary falls back to "Tax", not the shared default "Taxes" (`B/purchaseOrder/SummaryBlock.tsx:21`).
   - Sales Invoice maps `field: () => null` (`B/registry.tsx:81`), so a "Text field" block prints nothing on invoices; the editor offers it everywhere (`BlockList.tsx:216-229`).
   - ZPL `customField` prints `": value"` when the label is empty (`ProductLabelZPL.tsx:193`); the PDF prints "—".
5. Save strips unknown keys: every block schema is a plain `z.object` (`S:27-28, 90-249`),
   parsed twice (route `documentTemplateValidator`, `settings.models.ts:903-916`; service
   input `settings.server.ts:1530-1538`). New per-block fields must be added to `S`.
   `resolveTemplate` (render) runs no zod (`D:643-702`).
6. Merge tokens are plain strings: `TOKEN_RE = /\{\s*([\w.]+)\s*\}/g` (`M:21`);
   unknown tokens → `""` (`M:24-29`); `MergeField.token: string` (`M:14-19`);
   `MERGE_FIELDS: Record<string, MergeField[]>` (`M:271-284`). Nothing checks the 12
   `vars.ts` builders against the catalogs. Tracking label already drifts: label vars add
   `company.name/city/country` (`B/trackingLabel/vars.ts:21-23`) not in the catalog
   (`M:261-268`) nor ZPL `labelVars` (`ProductLabelZPL.tsx:11-21`). Date tokens are raw
   ISO except `order.approvedDate`.

## Shared chrome
- Footer `"{documentId}   Page n of N"` (`C/Footer.tsx:66-67`).
- Registration line `"{name} is registered in {country}, Company Registration Number {n}"` (`utils/shared.ts:43-45`); configurable: `registrationNumber`, `showRegistrationLine` (`S:292-306`).
- CustomFieldBlock "Yes"/"No"/"—" (`B/CustomFieldBlock.tsx:10-12,30`).
- C/Summary (stock transfer) appends ":" and prints "Phone:"/"Email:"/"Website:" (`C/Summary.tsx:77-84`).
- Country names forced to English (`utils/shared.ts:14`); `pluralize` English-only.

## Per document — hard-coded strings by block

Root `B/*.tsx` are the Sales Invoice blocks (registry `B/registry.tsx:25-91`), not shared.

### salesInvoice — title "Invoice"
- parties `B/PartiesBlock.tsx`: "Bill To" :67, "Tax ID:" :81, "VAT:" :83, "EORI:" :84, "Contact:" :85, "Email:" :86, "Invoice Details" :101, "Date Issued:" :106, "Due Date:" :112, "Customer Ref:" :117, "Sales Order(s):" :122-123, "Payment Terms:" :128, "Shipping:" :131, "Shipping Terms:" :135, "Incoterm:" :140, "Ship To" :155. Config: none.
- notes: "Notes" :18, "None" :24. Config: none.
- lineItems: "#","Description","Qty","Unit Price","Total" :55-59; "Tax & Fees" :127, "- Shipping" :134, "- Add-On" :146, "- Non-Taxable Add-On" :158, "- Tax (%)" :170, "EA" :183. Config: showThumbnails/zebra/textOverflow (`S:74-79`).
- summary: "Subtotal" :52, "Discount" :73, "Add-Ons" :94, "Shipping" :128, taxLabel :146, "Total" :162 (each "(CUR)"). Config: taxLabel (default "Taxes").
- terms: "Terms & Conditions" :33. Config: content.

### salesOrder — title "Sales Order"
- parties: "Customer" :53, Tax ID/VAT/EORI :66-69, "Order Details" :83, "Date:" :88, "Customer Ref:" :92, "Requested:" :96, "Promised:" :106, "Payment Terms:" :115, "Shipping:" :118, "Shipping Terms:" :121, "Incoterm:" :125, "Bill To" :139.
- notes "Notes"/"None"; lineItems "Description","Qty","Unit Price","Total" + tax & fees rows; summary "Subtotal","Add-Ons","Shipping",taxLabel,"Total"; terms.

### salesReturnOrder — title "Return Merchandise Authorization" (no summary block)
- parties: "Customer" :27, "Return Details" :48, "RMA Number:" :52, "Date:" :56, "Expires:" :62, "Customer Ref:" :71, "Return To" :80.
- lineItems: "#","Item","Qty Authorized","Unit Price","Reason" :48-52, "EA" :91, "Total" :105 (showThumbnails unused). notes, terms.

### purchaseOrder — title "Purchase Order" (header fixed on every page)
- parties: "Supplier" :80, Tax ID/VAT/EORI :94-100, "Contact:" :103, "Email:" :106, "Order Info" :117, "PO Number:" :121, "Date:" :125, "Currency:" :128, "Reference:" :130, "Requested:" :134, "Promised:" :144, "Payment Terms:" :153, "Incoterm:" :157, company VAT/EORI :166-167, buyer "Contact:"/"Email:"/"Phone:" :183-185, "Billing documents and enquiries:" :192, "Deliver To" :206.
- lineItems: "#","Description","Qty","UOM","Required","Unit Price","Net Value","Tax Value","Total" :62-72, "Shipping:" :143.
- summary: "Subtotal" :45, "Shipping" :60, taxLabel (fallback "Tax") :76, "Total" :87.
- approval: heading default "Approved By", caption default `{order.approvedBy}` / `{order.approvedDate}` (configurable). notes, terms.

### purchaseReturnOrder — title "Return to Supplier"
- header sub-id "Supplier RMA #:" :16. parties: "Return To" :28, "Return Details" :49, "Return Number:" :54, "Supplier RMA #:" :59, "Date:" :64, "Expires:" :70, "Ship From" :85. lineItems as SRO. notes, terms.

### purchasingRfq — title "Request for Quote" (letter layout, own letterhead)
- parties: "Date" :38, "Reference" :43, "Quotation due" :44, four QUOTATION_CONTENTS sentences :17-22, "Dear Supplier," :77, invitation sentence :79-80, "Your quotation should include:" :83, "Deliver to" :95, "Send your quotation to" :110.
- lineItems: "#","Item","Quantity","Unit" :71-74. notes: "Notes" :25, "Thank you. We look forward to receiving your quotation." :30, "Sincerely," :32. terms "Terms and Conditions" :29.

### quote — title "Quote"
- parties: "To" :49, Tax ID/VAT/EORI/Contact/Email :62-67, "Quote Details" :74, "Date:" :78, "Expires:" :87, "Reference:" :91, "Max Lead Time:" :95, "Payment Terms:" :99, "Incoterm:" :103.
- lineItems: "Description","Qty","Unit Price","Tax & Fees","Lead Time","Total" :80-91, row tax/fee lines :195-262, `{qty} EA` hard-coded :283, "N day(s)" :312.
- summary (QuoteSummaryBlock): "Subtotal","Shipping","Fees","Taxes" (fixed),"Total" :24-59 — ignores taxLabel. notes, terms.

### packingSlip — title from caller ("Packing Slip" / "Delivery Ticket")
- parties: "Ship To" :36, "Shipment Details" :57, "Date:" :62, "{sourceDocument}:" :67, "Customer PO #:" :71, "Tracking:" :74.
- details: "Shipping" :19, "Method:" :23, "Payment" :29, "Terms:" :32.
- lineItems: rental "Description","Qty","Serial"; normal "Description","Qty","Serial/Batch". notes "Notes"; terms "Standard Terms & Conditions".

### stockTransfer — title "Stock Transfer"
- details: "Date","Stock Transfer","Location","Assignee" :18-27 (via C/Summary). lineItems: "Description","Transfer","Qty","Pick" :49-52, "Any".

### jobTraveler — title "Job Traveler"
- header "SO# " :21. jobDetails: ~16 labels :63-161 ("Job ID:", "Part ID:", "Quantity:", "Due Date:" …).
- operations: "Seq","Operation","Expected Times" :86-88, "Setup:"/"Labor:"/"Machine:", "Batch Notes", "Procedure Steps", "Work Instructions" … Config: showWorkInstructions.
- notes "Job Notes". Materials table (not a block) "Item","Description","Quantity".

### issue — title "Issue Report"
- issueDetails "Issue Details","Type:","Status:","Initiated By:","Dates","Started:","Completed:"; associations group labels; notes "Description of Issue"; actionTasks "Verified by"/"Completed by", "Completed on:", "Inspections"; reviewers "MRB".

### trackingLabel
- labelRevision "Rev", labelQuantity "Qty", labelTracking "S/N"/"Batch" — configurable `label` (`S:149-155`); defaults repeated in PDF (`LabelBlocks.tsx:92,110,129-131`), ZPL (`ProductLabelZPL.tsx:105-118`) and editor (`labelConfigs.tsx:299-303`).

## Editor today (`apps/erp/app/components/DocumentTemplateEditor/`)
- Dispatch `BlockConfig.tsx:174-209`; `hasOwnConfig` :141-154. No panel for parties, notes, details, jobDetails, issueDetails, associations, actionTasks, reviewers, labelHeading.
- Panels exist for header (section modal + logo), footer, watermark, lineItems (thumbnails/zebra/wrap), operations, summary (tax label), terms, approval, label fields, richText, keyValue, spacer, field, barcode, logo, entityId, customField.
- Merge insert: `MergeFieldMenu.tsx:23-67` → `mergeToken` `{token}` (`M:81-83`); appended at end of text, not at the cursor (`BlockConfig.tsx:67-82`).
- State: `updateBlock` shallow patch (`context.tsx:267-272`); save posts JSON (`context.tsx:360-372`).
- Editor copy is mostly not Lingui (`BlockConfig.tsx`, `labelConfigs.tsx`, `MergeFieldMenu.tsx`, `BlockList.tsx`).

## Save path
Route `x+/templates+/$type.tsx:131-136` → `documentTemplateValidator` → `api.settings.saveDocumentTemplate`
(`settings.server.ts:1529`, `update: settings`) → `upsertDocumentTemplate` (`settings.service.ts:953+`,
one Kysely transaction, upsert on `(companyId, documentType)`, writes `CURRENT_TEMPLATE_FORMAT_VERSION`).
No check that a block type belongs to the document type.

## ZPL
Reads `block.label` (labelRevision/Quantity/Tracking, field, customField), `block.value`
(entityId, barcode, field), `placement`/`symbology`; visible blocks only, in order;
extension blocks skipped (`ProductLabelZPL.tsx:84, 105-200`). Text not escaped
(`zplFieldData` exists in `zpl/utils.ts:50` but unused here).
