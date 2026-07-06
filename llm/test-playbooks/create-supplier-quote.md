# Create Supplier Quote

Last tested: 2026-06-06
Route: /x/supplier-quote/new

## Prerequisites
- At least one supplier must exist (e.g., "Test Supplier Inc")

## Steps

### 1. Navigate
- URL: /x/supplier-quote/new
- Expected: "New Supplier Quote" form with fields for Supplier, Reference, Supplier Location, Supplier Contact, dates, currency, and Quote Type

### 2. Fill form
- Field "Supplier" (first combobox after Supplier Quote ID): Select "Test Supplier Inc"
- All other fields are optional
- Date Created defaults to today's date
- Currency defaults to "US Dollar"
- Quote Type defaults to "Purchase"

### 3. Submit
- Button: "Save"
- Note: Use `document.querySelector('button[type="submit"]')?.click()` if agent-browser click doesn't work

### 4. Verify
- Expected redirect: /x/supplier-quote/<new-id> (e.g., /x/supplier-quote/SQ000002)
- Success indicator: Page shows heading with Supplier Quote ID and buttons like "Finalize", "Cancel"

## Selector Notes
- Supplier combobox is the first combobox in the form
- Other fields: Reference (textbox), Supplier Location (combobox), Supplier Contact (combobox), Date Created (date picker), Expiration Date (date picker), Currency (combobox with clear button), Quote Type (combobox defaulting to "Purchase")

## Common Failures
- Save button may need JS click
- Supplier is the only required field
