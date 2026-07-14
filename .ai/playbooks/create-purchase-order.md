# Create Purchase Order

Last tested: 2026-06-06
Route: /x/purchase-order/new

## Prerequisites
- At least one supplier must exist. If none exist, the supplier combobox only shows "Create Supplier" — you can create one inline.

## Steps

### 1. Navigate
- URL: `/x/purchase-order/new`
- Expected: drawer form with heading "New Purchase Order"

### 2. Fill form
- Field "Supplier" (first combobox, labeled "Select"): search and select a supplier
  - If no suppliers exist, click "Create Supplier" option, fill name, click Save, then search for the new supplier
- Field "Location" (combobox, labeled "HEADQUARTERS"): auto-populated with default location
- Field "Currency" (combobox, labeled "US Dollar"): auto-populated from supplier

### 3. Submit
- Button: "Save" (at the bottom of the drawer form, before the "Close" button)

### 4. Verify
- Expected redirect: `/x/purchase-order/<id>` (detail page opens in drawer)
- Success indicator: heading shows "PO000001" (or next sequence), page shows "Add Line Item" buttons and detail sections (Shipping, Payment, Notes, Files)
- URL stays on the purchase orders list with the detail drawer open

## Selector Notes
- The supplier combobox is the first combobox in the form, initially showing "Select"
- When you click the supplier combobox, a search input appears — type to filter suppliers
- The location combobox auto-populates (e.g., "HEADQUARTERS") — no need to change it
- The currency combobox auto-populates when a supplier is selected (e.g., "US Dollar")
- The "Purchase Order Type" combobox defaults to "Purchase" — no need to change it
- The Save button is at the bottom of the drawer, before the Close button
- After save, the PO detail view opens with the PO ID as a heading

## Creating a Supplier Inline
- When the supplier combobox is open and no match is found, a "Create <search text>" option appears
- Clicking it opens a "New Supplier" drawer
- Only the name field is required — fill it and click Save
- After save, you return to the PO form with the supplier combobox open
- Search for the supplier you just created and select it

## Common Failures
- No suppliers in database — use the inline "Create Supplier" option
- Supplier combobox shows "Create a" — this means no suppliers match; type a name and use the create option
