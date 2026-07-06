# Create Sales Order

Last tested: 2026-06-06
Route: /x/sales-order/new

## Prerequisites
- At least one customer must exist (e.g., "Acme Corp")

## Steps

### 1. Navigate
- URL: /x/sales-order/new
- Expected: "New Sales Order" form with fields for Customer, PO Number, contacts, dates, location, sales person, currency

### 2. Fill form
- Field "Customer" (first combobox after Sales Order ID): Select "Acme Corp"
- All other fields are optional

### 3. Submit
- Button: "Save" (at the bottom of the form - may need to scroll down or use JS click)
- Note: The Save button ref may not be visible without scrolling. Use `document.querySelector('button[type="submit"]')?.click()` if needed.

### 4. Verify
- Expected redirect: /x/sales-order/<new-id> (e.g., /x/sales-order/SO000006)
- Success indicator: Page shows heading with the SO ID (e.g., "SO000006") and buttons like "Confirm", "Cancel", "Ship", "Invoice"

## Selector Notes
- Customer combobox is the first combobox in the form, after the "Sales Order ID" field
- The form has optional fields: Customer PO Number (textbox), Purchasing Contact, Engineering Contact, Customer Location, Requested Date, Promised Date, Shipping Location (defaults to HEADQUARTERS), Sales Person (defaults to logged-in user), Currency (defaults to US Dollar)
- Save button is a submit button at the bottom of the form

## Common Failures
- Save button may not respond to agent-browser click if not scrolled into view; use JS click via eval
- Form requires at least a customer to be selected
