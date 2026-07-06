# Create Sales Invoice

Last tested: 2026-06-07
Route: /x/sales/invoices (via "Add Sales Invoice" button)

## Prerequisites
- At least one customer must exist (e.g., "Acme Corp")

## Steps

### 1. Navigate
- URL: /x/sales/invoices or click "Invoices" in the Sales sidebar under MANAGE
- Expected: "Sales Invoices" list page with "Add Sales Invoice" button

### 2. Open form
- Click "Add Sales Invoice" button
- Expected: Drawer/overlay form with heading "New Sales Invoice" showing Invoice ID, Customer, Customer Invoice Number, Invoice Customer, locations, contacts, dates, payment terms, currency, and delivery location

### 3. Fill form
- Field "Invoice ID" (textbox, labeled "Next Sequence"): Leave as-is for auto-generated ID
- Field "Customer" (combobox, labeled "Select"): Required. Click to open, select customer (e.g., "Acme Corp"). This auto-fills Invoice Customer and Currency.
- Field "Customer Invoice Number" (textbox): Optional
- Field "Invoice Customer" (combobox): Auto-filled from Customer selection
- Field "Invoice Customer Location" (combobox, labeled "Select"): Optional
- Field "Invoice Customer Contact" (combobox, labeled "Select Contact"): Optional
- Field "Due Date" (date picker): Optional
- Field "Date Issued" (date picker): Defaults to today
- Field "Payment Terms" (combobox, labeled "Select"): Optional
- Field "Currency" (combobox): Auto-filled (e.g., "US Dollar")
- Field "Delivery Location" (combobox): Defaults to "HEADQUARTERS"

### 4. Submit
- Button: "Save"
- Note: Use eval-based click for reliable submission: `agent-browser eval "(function(){ document.querySelector('button[type=submit]').click(); return 'ok'; })()"`
- Wait 3 seconds for redirect

### 5. Verify
- Expected redirect: /x/sales-invoice/<new-id>/details (detail page)
- Success indicator: Page shows heading with invoice ID (e.g., "AR000001"), status badge "DRAFT", customer name, subtotal/tax/total summary
- Right sidebar shows PROPERTIES with ID, Assignee, Customer, Invoice Customer, dates
- Left panel shows "Add Line Item" button and empty line items area
- Internal/External notes tabs available
- Preview button available for PDF generation

## Selector Notes
- Customer is the first combobox after the Invoice ID field
- Selecting a customer auto-populates Invoice Customer and Currency fields
- The form is a drawer overlay on the invoices list, with a Close button

## Common Failures
- Customer is required; form won't submit without it
- If no customers exist, use "Create Customer" option in the combobox dropdown
- The Save button may require eval-based click for Remix forms
- A "Sales Invoices in Carbon" academy help panel may appear; dismiss with "Dismiss" button if it covers the form
