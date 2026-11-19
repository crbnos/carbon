# Per-document text edits and the lock after send — market survey

Question: how do mature ERP and invoicing products let a user change the printed text of ONE document (a purchase order, invoice, quote or sales order) without a change to the company-wide template? And how do they lock that text after the document is sent or posted?

Products: Odoo, NetSuite, SAP Business One, SAP S/4HANA, Microsoft Dynamics 365 Business Central, Xero, QuickBooks Online, Zoho Books, Katana, MRPeasy, Fishbowl.

Method: each claim cites a URL. For Odoo and Business Central, the claims come from the published source code on GitHub, not from help pages. A claim marked **[UNVERIFIED]** has no primary source that I could read.

Terms used in this file:

- **Per-document text**: text that a user types on one document and that prints on that document's PDF.
- **Template**: the company-wide layout that turns a document into a PDF.
- **Snapshot**: a stored copy of the PDF as it was when the document was sent or posted.
- **Lock**: the rule that stops edits after send or post.

---

## 1. Summary

| Product | Per-document text a user can edit | Where the edit lives | PDF snapshot on send / post | After send / post |
|---|---|---|---|---|
| Odoo 18 | Header "Terms and Conditions" (HTML); line notes and line sections; line descriptions | Columns on the document record (`narration`, `note`, `notes`, line `name`) | Yes. Send stores the PDF as an attachment on the invoice. Odoo never regenerates it while it exists | Posted invoice: lines, dates, partner locked. Edit needs Reset to Draft, which detaches the old PDF and renames it "(detached by …)" |
| NetSuite | Memo, Customer Message, custom body fields, line descriptions. Choice of custom form per transaction | Fields on the transaction record | Email copy, with its attachments, is saved on the transaction's Communication subtab. Print storage **[UNVERIFIED]** | Closed period: only non-G/L fields, and only with the "Allow Non-G/L Changes" setting and permission |
| SAP Business One | Opening and Closing Remarks; text rows (type "T"); Remarks | Fields and rows on the document | **[UNVERIFIED]** | Remarks stay editable after add. Lock rules for other fields and the change log are **[UNVERIFIED]** (secondary sources only) |
| SAP S/4HANA | Header and item texts (text determination, standard texts) | Text objects on the document | Yes. Output control saves the rendered document in the KPRO archive per output request | Not researched in depth |
| Business Central | Work Description (multiline, header); comment lines; extended text lines | `Work Description` BLOB on the header; lines on the document. Posting copies both to the posted document | Optional. "Attach as PDF" stores a PDF in the Attachment part. It is a manual action in standard | Posted sales invoice: not editable (except in some countries). Correct or cancel, or a credit memo |
| Xero | Line descriptions, Reference, choice of branding theme. No free-text notes field on the invoice | Fields on the invoice; terms text lives in the branding theme | **[UNVERIFIED]** — no evidence of a stored PDF | Approved invoices stay editable. A payment blocks edits until someone removes it. Lock dates block older periods |
| QuickBooks Online | "Message displayed on invoice" (default per form, overwrite per invoice) | Field on the invoice | No. The online invoice link shows the current version | Sent invoices stay editable. The customer link shows the edit. Closing date blocks older periods |
| Zoho Books | Customer Notes, Terms & Conditions; choice of PDF template per invoice | Fields on the invoice; template id per invoice | **[UNVERIFIED]** | Record locking (plan-gated) and transaction locking by date. Unlock needs a reason |
| Katana | No in-app per-document print text found. "Editable fields" become fillable fields in the exported PDF | In the PDF file, not in Katana | No | **[UNVERIFIED]** |
| MRPeasy | Per-order custom fields can print through the PDF editor. Footers are per document type, not per order | Custom field on the order | **[UNVERIFIED]** | **[UNVERIFIED]** |
| Fishbowl | Header note and line notes exist on the PO | Fields on the PO | **[UNVERIFIED]** | PO has Issue / Unissue / Void. Edit rules not found |

No product in this list lets a user override a template's labels or headings (for example, "Purchase Order" → "Blanket Order") for one document only. Each one offers free-text fields on the record, plus a choice between whole templates.

---

## 2. Odoo 18 — read from source

### 2.1 What a user can edit on one document

- **Invoice header text.** `account.move.narration` is an HTML field with the label "Terms and Conditions". It is computed, stored and editable (`compute='_compute_narration', store=True, readonly=False`). [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py)
- **Default comes from the company.** `_compute_narration` copies `company_id.invoice_terms` into `narration` when the `account.use_invoice_terms` setting is on. The text is translated to the partner's language. After that, the user edits the copy on the invoice. [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py)
- **Sales order header text.** `sale.order.note` is an HTML field, "Terms and conditions", computed and editable. Invoicing copies it to the invoice: `'narration': self.note`. [sale_order.py](https://github.com/odoo/odoo/blob/18.0/addons/sale/models/sale_order.py)
- **Purchase order header text.** `purchase.order.notes` is an HTML field, "Terms and Conditions". The PO report prints it with `<p t-field="o.notes"/>`. [purchase_order.py](https://github.com/odoo/odoo/blob/18.0/addons/purchase/models/purchase_order.py), [purchase_order_templates.xml](https://github.com/odoo/odoo/blob/18.0/addons/purchase/report/purchase_order_templates.xml)
- **Per-line text.** The invoice line editor has "Add a section" and "Add a note" controls (`display_type` `line_section` and `line_note`). Each line's `name` is its description. [account_move_views.xml](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_move_views.xml)
- **The report prints them.** The invoice report renders section rows, note rows, and `o.narration` in a block named `comment`. [report_invoice.xml](https://github.com/odoo/odoo/blob/18.0/addons/account/views/report_invoice.xml)
- **Company-wide setting.** The help page sets default terms under Accounting → Configuration → Settings. Terms print "at the bottom of the document". [Odoo docs: terms and conditions](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/terms_conditions.html)

### 2.2 Where the edit lives

All per-document text is a column on the document record. Odoo never copies the template. The template (a QWeb view) is shared, and it reads the record's fields.

### 2.3 PDF snapshot

- When the send flow renders an invoice, it creates an `ir.attachment` with `res_field: 'invoice_pdf_report_file'`. It sets `message_main_attachment_id` and `is_move_sent = True`. [account_move_send.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move_send.py)
- The send flow does not render a new PDF if one exists: "we don't regenerate pdf if it already exists". [account_move_send.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move_send.py)
- `_get_invoice_legal_documents` returns that stored PDF as the invoice's legal document. It builds a pro-forma only as a fallback. [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py)
- The help field on `is_move_sent` reads: "It indicates that the invoice/payment has been sent or the PDF has been generated." [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py)

### 2.4 After posting

- The help page states: "Once confirmed, an invoice can no longer be updated. Click Reset to draft if changes are needed." [Odoo docs: customer invoices](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices.html)
- The server refuses writes to these fields on a posted move: `invoice_line_ids`, `line_ids`, `invoice_date`, `date`, `partner_id`, `invoice_payment_term_id`, `currency_id`, `fiscal_position_id`, `invoice_cash_rounding_id`. [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py)
- `narration` is NOT in that list. So the server still accepts a change to the terms text on a posted invoice. The stored PDF does not change, because Odoo does not regenerate it. (I read this from the code. I did not test it in the UI.)
- `button_draft` (Reset to Draft) calls `_detach_attachments`. That function unlinks the stored PDF from the invoice field and renames the file "&lt;name&gt; (detached by &lt;user&gt; on &lt;date&gt;).pdf". The old PDF stays as an ordinary attachment, so the history keeps it. [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py)
- A journal with "Lock Posted Entries with Hash" stops Reset to Draft. The hash covers `name`, `date`, `journal_id` and `company_id` plus line fields. It does not cover `narration`. [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py), [Odoo docs: customer invoices](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices.html)

---

## 3. NetSuite

### 3.1 What a user can edit on one transaction

- Standard header fields such as Memo and Customer Message print when the Advanced PDF/HTML template references them. For sales layouts, the message box reads the Customer Message field (internal id `message`). [Gurus Solutions KB](https://answers.gurussolutions.com/?p=2127), [Oracle community thread](https://community.oracle.com/netsuite/english/discussion/4507892/nsc-customer-message-not-showing-on-invoice-pdf)
- Admins add custom transaction body fields and reference them in the template. The common pattern for any new per-document text is "custom body field + template reference". [Gurus Solutions KB](https://answers.gurussolutions.com/?p=2127)
- When a user emails a transaction, they "can select a standard message from the Select Message list or type a message in the Customer Message field". [Oracle help: Emailing Transactions](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N513303.html)

### 3.2 Template choice per transaction

- Each transaction uses a custom form. The form names one print template and one email template. "When you set a custom form to use an advanced template, that template defines the print and email formatting and contents for transactions that use that custom form." [Oracle help: Setting Custom Forms to Use Advanced Templates](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2863334.html)
- The user can pick the form on the transaction. Role, workflow or script can also set it. [Oracle help: Transaction Forms and User Printing Preferences](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4453528352.html)

### 3.3 Snapshot

- "NetSuite automatically saves a copy of the message and records the audit trail." [Oracle help: Emailing Transactions](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N513303.html)
- "You can view a log of sent transaction email, including any attachments … A list of sent email is also available in the same location on the transaction record." [Oracle help: Emailing Transactions](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N513303.html)
- So the emailed PDF survives as an attachment of the saved message. The Print button renders the PDF live each time. **[UNVERIFIED: I found no Oracle page that says Print never stores a copy.]**

### 3.4 After posting

- Transactions in a closed period accept only non-G/L changes. Both the period's "Allow Non-G/L Changes" box and the role permission are needed. Memo and custom fields are the usual examples. [Chargebee KB](https://support.chargebee.com/support/solutions/articles/254916-netsuite-error-you-cannot-make-changes-to-this-period-without-the-allow-non-g-l-changes-permission), [Gurus Solutions KB](https://answers.gurussolutions.com/?p=2075)
- Inside an open period, a user with edit rights can change the transaction after it was emailed. **[UNVERIFIED: no Oracle page read that states this directly.]**

---

## 4. SAP Business One

### 4.1 What a user can edit on one document

- **Opening and Closing Remarks.** "This window enables you to include additional text related to the current document. You can enter it manually or you can insert a predefined text." "This text appears in the printed document, if the print layout is designed for that purpose." [SAP help: Opening and Closing Remarks](https://help.sap.com/saphelp_sbo92/helpdata/en/44/fd94b093202463e10000000a1553f7/content.htm)
- **Text rows.** A user adds rows of type "T" to the Contents tab for free or predefined text. "The content of the text row can be printed when you print the document." [SAP help: text rows](https://help.sap.com/saphelp_sbo92/helpdata/en/44/fd93f393202463e10000000a1553f7/content.htm)
- **Predefined texts** are a master list, set under Administration → Setup → General → Predefined Text. The SDK service `PredefinedTextsService` manages them. [SAP SDK help](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/SAPbobsCOM~PredefinedTextsService.html)
- **Remarks** on the A/R invoice header: "You can edit the field contents even after the document is added." [SAP help: A/R invoice general area](https://help.sap.com/saphelp_sbo92/helpdata/en/44/fd8a11a7100484e10000000a155369/content.htm)

### 4.2 Pattern

A user picks a predefined text, and SAP copies it into the document. Then the user edits the copy. The master text never changes, so the edit stays on one document.

### 4.3 After posting

- A search excerpt of SAP help says that after a sales document is posted, a user cannot delete it or make changes that affect inventory or journal entries. [SAP help (search excerpt)](https://help.sap.com/saphelp_sbo882/helpdata/en/38/aaaeb0c22c4fb397d406080f6c1a00/content.htm) **[UNVERIFIED: the page did not load in full.]**
- An SAP community answer for version 9.3 says that line-level text is not editable after add, but header text and its user-defined fields are. [SAP community answer](https://answers.sap.com/questions/654414/invoice-text-edit-in-ar-invoice.html) **[UNVERIFIED: secondary source, older version.]**
- SAP Business One records changes to added documents in the change log. [SAP help (search excerpt)](https://help.sap.com/saphelp_sbo91/helpdata/en/44/fd8a11a7100484e10000000a155369/content.htm) **[UNVERIFIED: I did not read the full page.]**
- PDF snapshot on send: **[UNVERIFIED]**.

---

## 5. SAP S/4HANA

- **Texts.** Text determination fills header texts on a sales document from standard texts (SO10). The user then edits the text on that document. [SAP blog: default text in sales order header](https://blogs.sap.com/2014/12/23/default-text-in-sales-order-header/) (2014, older on-premise)
- **Templates.** SAP tells users to copy a predelivered form template, then edit the copy. The Output Parameter Determination app picks which template to use. [SAP community: extending form templates](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/extending-form-templates-for-sales-document-output/ba-p/14256735)
- **Snapshot.** "When output is being issued, the output control framework records the output device type in the output request and saves the rendered document … in the KPRO archive." Display later reads that stored file. [SAP KBA 3460975](https://userapps.support.sap.com/sap/support/knowledge/en/3460975)
- Each output request is a record of one issue action, with its device, parameters and status. So S/4HANA keeps one stored rendering per output, not one per document.

---

## 6. Microsoft Dynamics 365 Business Central — read from source

### 6.1 What a user can edit on one document

- **Work Description.** A multiline text on sales quotes, orders and invoices. [Microsoft release plan (archived)](https://learn.microsoft.com/en-us/dynamics365-release-plan/2021wave2/smb/dynamics365-business-central/synchronize-multiline-text-fields-between-business-central-dataverse-dynamics-365-sales)
- It is a BLOB on the header: `field(200; "Work Description"; BLOB)`. The posted invoice table `Sales Invoice Header` has the same field. [SalesInvoiceHeader.Table.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Sales/History/SalesInvoiceHeader.Table.al)
- The standard invoice report prints it. The `WorkDescriptionLines` data item reads `Header."Work Description"` line by line, and `ShowWorkDescription` is true when the field has a value. [StandardSalesInvoice.Report.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Sales/History/StandardSalesInvoice.Report.al). The quote report has the same data item. [StandardSalesQuote.Report.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Sales/Document/StandardSalesQuote.Report.al)
- **Comment lines.** "If the line is for a comment. Write the comment in the Description field" and leave No. blank. [Microsoft Learn: Invoice sales](https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-invoice-sales)
- **Extended text.** A master text on an item, G/L account or resource. A user inserts it on a line with **Insert Ext. Text**, or Business Central adds it automatically. The text lands as extra lines on the document. [Microsoft Learn: Add extended text](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-how-define-ext-text)

### 6.2 Layouts per customer

- A customer card has a **Document Layouts** action. It sets a different report layout per document type for that customer. It takes priority over the company Report Selection. [Microsoft Learn training](https://learn.microsoft.com/en-us/training/modules/change-documents-dynamics-365-business-central/define-document-layouts), [RSM blog](https://technologyblog.rsmus.com/microsoft/dynamics-365-business-central/use-different-document-layouts-for-customers-and-vendors)
- This is per customer, not per document.

### 6.3 Snapshot

- Posting copies the document into separate posted tables (`Sales Invoice Header`, and so on). The Work Description goes with it, because the posted table has the same field. [SalesInvoiceHeader.Table.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Sales/History/SalesInvoiceHeader.Table.al)
- "Post and Send" generates a PDF to send. [Microsoft Learn: Posting sales documents](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-post-sales)
- **Attach as PDF** "Generate[s] and add[s] the generated document in PDF format to the Attachment part." "The Attachment part allows you to store and manage printed document versions for future reference." [Microsoft Learn: Posting sales documents](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-post-sales)
- In standard Business Central, Attach as PDF is a manual action. Automatic attach on post needs an extension. [yzhums blog](https://yzhums.com/20657/)

### 6.4 After posting

- A posted sales invoice is not editable in most markets. **Update Document** opens a "- Update" page with a subset of fields. It covers Posted Sales Shipment, Posted Purchase Invoice and Posted Return documents. Posted Sales Invoice is editable only in ES. [Microsoft Learn: Edit posted documents](https://learn.microsoft.com/en-us/dynamics365/business-central/across-edit-posted-document)
- To change a posted invoice, a user corrects or cancels it before payment, or makes a credit memo after payment. [Microsoft Learn: Invoice sales](https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-invoice-sales)

---

## 7. Xero

### 7.1 What a user can edit on one invoice

- The public API schema for an invoice has `Reference`, `LineItems` (each with a description) and `BrandingThemeID`. It has no free-text notes or message field. [Xero OpenAPI spec, Invoice schema](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml)
- Terms text lives in the branding theme ("Terms & Payment Advice"). So to change terms for one invoice, a user picks another theme. [ezyCollect guide](https://ezycollect.io/academy/blog/how-to-customise-xero-invoice-templates), [Marmalade help](https://marmalade.ladesk.com/882629-NEW-Updating-Invoice-Templates-in-Xero)
- Users ask for per-invoice wording control as a product idea. [Xero product idea](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/51375709-invoice-ability-to-edit-phrasing-on-the-new-bran)

### 7.2 After approval and send

- `SentToContact` "can be set only on invoices that have been approved". It is a flag, not a lock. [Xero OpenAPI spec](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml)
- Users must remove payments before they edit an invoice. A product idea asks for the "Ability to edit invoice without having to remove and redo all payments on that invoice". A commenter says Xero requires this "merely to correct a reference or line description". [Xero product idea](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/46765579-invoice-edit-invoice-without-removing-the-paymen)
- Lock dates stop edits to transactions dated before the lock. [ApprovalMax KB](https://support.approvalmax.com/portal/en/kb/articles/how-is-a-lock-date-handled-for-xero-sales-invoices)
- PDF snapshot: **[UNVERIFIED]**. I found no evidence that Xero stores the sent PDF.

---

## 8. QuickBooks Online

### 8.1 What a user can edit on one invoice

- Defaults are set in Settings → Account and settings → Sales → Messages. A user can set a different default per sales form. [Intuit help: customer messages](https://quickbooks.intuit.com/learn-support/en-us/customize-forms/how-to-set-up-or-change-customer-messages/00/186388)
- "You can overwrite the default message on an individual sales form." The field on the form is "Message displayed on …". [Intuit help: customer messages](https://quickbooks.intuit.com/learn-support/en-us/customize-forms/how-to-set-up-or-change-customer-messages/00/186388)
- Intuit staff say the message cannot be set per custom form style; it flows over all styles. [Intuit community](https://quickbooks.intuit.com/community/other-questions-36/how-can-you-change-messages-on-different-invoice-styles-109732)

### 8.2 After send

- A sent invoice stays editable. For online invoices, the customer "will see that change if they go back to the emailed invoice and refresh the page". "You cannot turn that off." [Intuit community](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/when-i-update-an-invoice-i-don-t-want-the-customer-to-see-the/00/754427)
- For HTML or plain-text invoices, the customer does not see the change until the user re-sends. [Intuit community](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/when-i-update-an-invoice-i-don-t-want-the-customer-to-see-the/00/754427)
- Closing the books locks transactions dated on or before the closing date. QuickBooks warns or asks for a password, as configured. [Intuit help: close the books](https://quickbooks.intuit.com/learn-support/en-us/customer-company-settings/how-to-close-the-books/00/186384)
- The audit log records who changed what, and a user cannot turn it off. [Intuit help: audit log](https://quickbooks.intuit.com/learn-support/en-us/audit-log/use-the-audit-log-in-quickbooks-online/00/186180)
- So QuickBooks has no per-document snapshot. The audit log is the only record of the earlier version.

---

## 9. Zoho Books

- An invoice has **Customer Notes** ("Add notes to display them in the invoice") and **Terms and Conditions** ("Add your business terms and conditions for the invoice"). [Zoho help: invoices](https://www.zoho.com/books/help/invoice/)
- Defaults come from Settings → Preferences. A user can keep them on a quote's converted invoice. [Zoho KB](https://www.zoho.com/books/kb/quotes/customer-notes-terms-conditions.html)
- A user can pick a different PDF template for one invoice from the PDF Template section. [Zoho KB: change invoice template](https://www.zoho.com/books/kb/templates/change-invoice-template.html)
- **Record locking**: "Once locked, only users with roles that have sufficient permission will be able to update records." A user who unlocks must enter a reason. Invoices get action-level restrictions, not field-level restrictions. It is available only on some plans. [Zoho help: record locking](https://www.zoho.com/en-ng/books/help/settings/customization/record-locking.html)
- **Transaction locking** freezes all transactions before a lock date, per module. [Zoho help: transaction locking](https://www.zoho.com/en-fr/books/help/accountant/transaction-lock.html)
- PDF snapshot on send: **[UNVERIFIED]**.

---

## 10. Katana

- A PO card has an **Additional info** section "to add internal notes, instructions, reference numbers, or hyperlinks". [Katana help: creating a PO](https://support.katanamrp.com/en/articles/119-creating-a-new-purchase-order) Whether it prints: **[UNVERIFIED]**.
- Custom print templates use Katana's PDF Editor, built on PDF Generator API. Template edits are company-wide. [Katana help: basics of printing](https://support.katanamrp.com/en/articles/5967636-basics-of-printing)
- **Editable fields** are the only per-document print text. "Use editable fields in Katana's PDF Editor to allow text entry after the PDF has been generated." The user fills them in a PDF viewer, so Katana never stores the text. [Katana help: editable fields](https://support.katanamrp.com/en/articles/6138513-adding-editable-fields-to-print-templates)
- The order's 3-dot menu shows a changelog for that order. [Katana help: creating a PO](https://support.katanamrp.com/en/articles/119-creating-a-new-purchase-order)

## 11. MRPeasy

- mrpeasy.com refused my fetch (HTTP 403). These claims come from search excerpts only. **[UNVERIFIED for all MRPeasy claims.]**
- The PDF Editor sets footers per document type, plus a general footer on all documents. Footers are not per order. [MRPeasy manual: PDF Editor](https://www.mrpeasy.com/resources/user-manual/settings/system/pdf/)
- Custom fields (free text, number, date, list) attach to customer orders and invoices. A user can add them to PDF layouts in the PDF Editor. This is the only route to per-order printed text. [MRPeasy manual: custom fields](https://www.mrpeasy.com/documentation/settings/system/custom-columns)

## 12. Fishbowl

- The PO import format has a header `Note` and an item-level `Note` ("PO Item Notes"). PO statuses are 10 Bid Request, 15 Pending Approval, 20 Issued, 95 Historical. [Fishbowl help: import purchase order](https://help.fishbowlinventory.com/advanced/s/importPurchaseOrder.html)
- The PO module can issue, unissue and void purchase orders. [Fishbowl blog](https://www.fishbowlinventory.com/blog/the-power-of-the-purchase-order-module)
- Whether a user must unissue a PO before an edit, and whether notes print: **[UNVERIFIED]**.

---

## 13. Patterns across products

### 13.1 Where per-document text lives

Every product stores per-document text as fields on the document record. No product copies the template for one document.

| Pattern | Products |
|---|---|
| Header free text, defaulted from a company or partner setting, then edited on the document | Odoo (`narration`, `note`, `notes`), QuickBooks (message), Zoho (notes, terms), Business Central (Work Description) |
| Pick a master text, copy it in, edit the copy | SAP Business One (predefined texts), Business Central (extended text), SAP S/4HANA (standard texts) |
| Free-text rows mixed with item lines | Odoo (line note, line section), Business Central (comment lines), SAP Business One ("T" rows) |
| Custom field on the record, referenced by the template | NetSuite, MRPeasy |
| Pick another whole template for one document | NetSuite (custom form), Zoho (PDF template), Xero (branding theme), Business Central (per customer only) |

No product found lets a user override a template's fixed labels or headings for one document.

### 13.2 How products lock after send or post

| Pattern | Products |
|---|---|
| Hard lock on post; edit needs a reverse step (reset to draft, correct, credit memo) | Odoo, Business Central, SAP Business One |
| A few safe fields stay editable after post (remarks, tracking number, memo) | SAP Business One (Remarks), Business Central (Update Document), NetSuite (non-G/L fields), Odoo (`narration` is not in the write block) |
| Editable after send; a period lock or payment stops it later | QuickBooks, Xero, Zoho, NetSuite |
| Explicit record lock with role bypass and a reason to unlock | Zoho (record locking) |

### 13.3 Snapshot on send

Three products keep a stored copy of what the customer got:

1. **Odoo** stores the sent PDF on the invoice and never re-renders it while it exists. Reset to Draft keeps the old file and renames it. [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py), [account_move_send.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move_send.py)
2. **NetSuite** saves each sent email with its attachments on the transaction. [Oracle help](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N513303.html)
3. **SAP S/4HANA** saves the rendered output per output request in KPRO. [SAP KBA 3460975](https://userapps.support.sap.com/sap/support/knowledge/en/3460975)

Business Central offers a manual "Attach as PDF". QuickBooks shows the live version to the customer and keeps only an audit log.

### 13.4 Why a snapshot matters

The EU VAT Directive, Article 233, requires that "the authenticity of the origin, the integrity of the content and the legibility of an invoice … shall be ensured from the point in time of issue until the end of the period for storage". Each business picks how. One option is "business controls creating a reliable audit trail". [Directive 2006/112/EC, Art. 233](https://www.legislation.gov.uk/eudr/2006/112/article/233), [EC explanatory notes](https://taxation-customs.ec.europa.eu/system/files/2016-09/explanatory_notes_en.pdf)

A stored PDF is the simplest proof of what the customer received. A product that re-renders from live data (QuickBooks) proves it only through its audit log.

---

## 14. Gaps

- Xero, Zoho, SAP Business One, Katana, MRPeasy and Fishbowl: I found no source on whether they store the sent PDF.
- MRPeasy pages refused the fetch. All MRPeasy claims rest on search excerpts.
- NetSuite: I found no Oracle page that says Print never stores a copy.
- Odoo: the claim that a posted invoice's `narration` stays editable comes from the server code. I did not test the form view.

## Sources

- Odoo source, 18.0: [account_move.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py), [account_move_send.py](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move_send.py), [account_move_views.xml](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_move_views.xml), [report_invoice.xml](https://github.com/odoo/odoo/blob/18.0/addons/account/views/report_invoice.xml), [sale_order.py](https://github.com/odoo/odoo/blob/18.0/addons/sale/models/sale_order.py), [purchase_order.py](https://github.com/odoo/odoo/blob/18.0/addons/purchase/models/purchase_order.py), [purchase_order_templates.xml](https://github.com/odoo/odoo/blob/18.0/addons/purchase/report/purchase_order_templates.xml)
- Odoo docs: [terms and conditions](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/terms_conditions.html), [customer invoices](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices.html)
- NetSuite: [Emailing Transactions](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N513303.html), [Setting Custom Forms to Use Advanced Templates](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2863334.html), [Transaction Forms and User Printing Preferences](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4453528352.html), [Gurus Solutions ANS-1908](https://answers.gurussolutions.com/?p=2127), [Gurus Solutions ANS-1856](https://answers.gurussolutions.com/?p=2075), [Oracle community: customer message](https://community.oracle.com/netsuite/english/discussion/4507892/nsc-customer-message-not-showing-on-invoice-pdf), [Chargebee KB](https://support.chargebee.com/support/solutions/articles/254916-netsuite-error-you-cannot-make-changes-to-this-period-without-the-allow-non-g-l-changes-permission)
- SAP Business One: [Opening and Closing Remarks](https://help.sap.com/saphelp_sbo92/helpdata/en/44/fd94b093202463e10000000a1553f7/content.htm), [text rows](https://help.sap.com/saphelp_sbo92/helpdata/en/44/fd93f393202463e10000000a1553f7/content.htm), [A/R invoice general area](https://help.sap.com/saphelp_sbo92/helpdata/en/44/fd8a11a7100484e10000000a155369/content.htm), [PredefinedTextsService](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/SAPbobsCOM~PredefinedTextsService.html), [SAP community answer](https://answers.sap.com/questions/654414/invoice-text-edit-in-ar-invoice.html)
- SAP S/4HANA: [KBA 3460975](https://userapps.support.sap.com/sap/support/knowledge/en/3460975), [extending form templates](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/extending-form-templates-for-sales-document-output/ba-p/14256735), [default text in sales order header](https://blogs.sap.com/2014/12/23/default-text-in-sales-order-header/)
- Business Central source: [SalesInvoiceHeader.Table.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Sales/History/SalesInvoiceHeader.Table.al), [StandardSalesInvoice.Report.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Sales/History/StandardSalesInvoice.Report.al), [StandardSalesQuote.Report.al](https://github.com/microsoft/BCApps/blob/main/src/Layers/W1/BaseApp/Sales/Document/StandardSalesQuote.Report.al)
- Business Central docs: [Posting sales documents](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-post-sales), [Invoice sales](https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-invoice-sales), [Edit posted documents](https://learn.microsoft.com/en-us/dynamics365/business-central/across-edit-posted-document), [Add extended text](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-how-define-ext-text), [Work Description release note](https://learn.microsoft.com/en-us/dynamics365-release-plan/2021wave2/smb/dynamics365-business-central/synchronize-multiline-text-fields-between-business-central-dataverse-dynamics-365-sales), [Document layouts training](https://learn.microsoft.com/en-us/training/modules/change-documents-dynamics-365-business-central/define-document-layouts), [RSM blog](https://technologyblog.rsmus.com/microsoft/dynamics-365-business-central/use-different-document-layouts-for-customers-and-vendors), [yzhums: Attach as PDF](https://yzhums.com/20657/)
- Xero: [OpenAPI spec](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml), [idea: edit without removing payment](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/46765579-invoice-edit-invoice-without-removing-the-paymen), [idea: edit phrasing on branding theme](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/51375709-invoice-ability-to-edit-phrasing-on-the-new-bran), [ezyCollect guide](https://ezycollect.io/academy/blog/how-to-customise-xero-invoice-templates), [Marmalade help](https://marmalade.ladesk.com/882629-NEW-Updating-Invoice-Templates-in-Xero), [ApprovalMax KB](https://support.approvalmax.com/portal/en/kb/articles/how-is-a-lock-date-handled-for-xero-sales-invoices)
- QuickBooks Online: [customer messages](https://quickbooks.intuit.com/learn-support/en-us/customize-forms/how-to-set-up-or-change-customer-messages/00/186388), [messages per style](https://quickbooks.intuit.com/community/other-questions-36/how-can-you-change-messages-on-different-invoice-styles-109732), [edits after send](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/when-i-update-an-invoice-i-don-t-want-the-customer-to-see-the/00/754427), [close the books](https://quickbooks.intuit.com/learn-support/en-us/customer-company-settings/how-to-close-the-books/00/186384), [audit log](https://quickbooks.intuit.com/learn-support/en-us/audit-log/use-the-audit-log-in-quickbooks-online/00/186180)
- Zoho Books: [invoices](https://www.zoho.com/books/help/invoice/), [notes and terms defaults](https://www.zoho.com/books/kb/quotes/customer-notes-terms-conditions.html), [change invoice template](https://www.zoho.com/books/kb/templates/change-invoice-template.html), [record locking](https://www.zoho.com/en-ng/books/help/settings/customization/record-locking.html), [transaction locking](https://www.zoho.com/en-fr/books/help/accountant/transaction-lock.html)
- Katana: [creating a PO](https://support.katanamrp.com/en/articles/119-creating-a-new-purchase-order), [basics of printing](https://support.katanamrp.com/en/articles/5967636-basics-of-printing), [editable fields](https://support.katanamrp.com/en/articles/6138513-adding-editable-fields-to-print-templates)
- MRPeasy: [PDF Editor](https://www.mrpeasy.com/resources/user-manual/settings/system/pdf/), [custom fields](https://www.mrpeasy.com/documentation/settings/system/custom-columns)
- Fishbowl: [import purchase order](https://help.fishbowlinventory.com/advanced/s/importPurchaseOrder.html), [PO module blog](https://www.fishbowlinventory.com/blog/the-power-of-the-purchase-order-module)
- Regulation: [Directive 2006/112/EC, Art. 233](https://www.legislation.gov.uk/eudr/2006/112/article/233), [EC explanatory notes on invoicing](https://taxation-customs.ec.europa.eu/system/files/2016-09/explanatory_notes_en.pdf)
