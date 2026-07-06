# Create Purchase Invoice

Last tested: 2026-06-07
Route: /x/purchasing/invoices (via "Add Purchase Invoice" button)

## Prerequisites
- At least one supplier must exist (e.g., "Test Supplier Inc")

## Steps

### 1. Navigate
- URL: /x/purchasing/invoices or click "Invoices" in the Purchasing sidebar
- Expected: "Purchase Invoices" list page with "Add Purchase Invoice" button

### 2. Open form
- Click "Add Purchase Invoice" button
- Expected: Full-page form with heading "New Purchase Invoice" showing Invoice ID, Supplier, Supplier Invoice Number, Invoice Supplier, locations, contacts, dates, payment terms, currency, and delivery location

### 3. Fill form
- Field "Invoice ID" (textbox, labeled "Next Sequence"): Leave as-is for auto-generated ID
- Field "Supplier" (combobox, labeled "Select"): Required. Click to open, select supplier (e.g., "Test Supplier Inc"). This auto-fills Invoice Supplier and Currency.
- Field "Supplier Invoice Number" (textbox): Optional
- Field "Invoice Supplier" (combobox): Auto-filled from Supplier selection
- Field "Invoice Supplier Location" (combobox, labeled "Select"): Optional
- Field "Invoice Supplier Contact" (combobox, labeled "Select Contact"): Optional
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
- Expected redirect: /x/purchase-invoice/<new-id>/details (detail page)
- Success indicator: Page shows heading with invoice ID (e.g., "AP000001"), status badge "DRAFT", supplier name, subtotal/tax/total summary
- Right sidebar shows PROPERTIES with ID, Assignee, Supplier, Invoice Supplier, dates
- Left panel shows "Add Line Item" button and empty line items area

## Selector Notes
- Supplier is the first combobox after the Invoice ID field
- Selecting a supplier auto-populates Invoice Supplier and Currency fields
- The form is a full-page route, not a modal

## Common Failures
- Supplier is required; form won't submit without it
- If no suppliers exist, use "Create Supplier" option in the combobox dropdown
- The Save button may require eval-based click for Remix forms
