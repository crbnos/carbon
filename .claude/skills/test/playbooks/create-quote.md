# Create Quote

Last tested: 2026-06-06
Route: /x/quote/new

## Prerequisites
- At least one customer must exist (e.g., "Acme Corp")

## Steps

### 1. Navigate
- URL: /x/quote/new
- Expected: "New Quote" form with fields for Customer, Name, contacts, sales person, estimator, location, dates, currency

### 2. Fill form
- Field "Customer" (first combobox after Quote ID): Select "Acme Corp"
- All other fields are optional
- Expiration Date defaults to 30 days from today

### 3. Submit
- Button: "Save" (at the bottom of the form)
- Note: Use `document.querySelector('button[type="submit"]')?.click()` if agent-browser click doesn't work

### 4. Verify
- Expected redirect: /x/quote/<new-id> (e.g., /x/quote/Q000002)
- Success indicator: Page shows heading with the Quote ID and buttons like "Finalize", "Won", "Lost", "Cancel"

## Selector Notes
- Customer combobox is the first combobox in the form
- Form has optional fields: Name (textbox), Purchasing Contact, Engineering Contact, Customer Location, Sales Person (defaults to logged-in user), Estimator, Location (defaults to HEADQUARTERS), Requested Date, Expiration Date (defaults to 30 days out), Currency
- Save button is a submit button at the bottom

## Common Failures
- Save button may need JS click to work reliably
- Customer is the only required field
