# Create Warehouse Transfer

Last tested: 2026-06-06
Route: /x/warehouse-transfer/new

## Prerequisites
- At least two different locations must exist (e.g., "HEADQUARTERS" and "SECONDARY")
- If only one location exists, create a second one via Resources > Locations > Add Location before testing

## Steps

### 1. Navigate
- URL: /x/warehouse-transfer/new
- Expected: "New Warehouse Transfer" form with Transfer ID, Reference, From Location, To Location, and Notes

### 2. Fill form
- Field "From Location" (first location combobox): Defaults to "HEADQUARTERS"
- Field "To Location" (second location combobox): Click and select a DIFFERENT location (e.g., "SECONDARY")
- Notes is optional

### 3. Submit
- Button: "Save"
- Note: Use `document.querySelector('button[type="submit"]')?.click()` if agent-browser click doesn't work

### 4. Verify
- Expected redirect: /x/warehouse-transfer/<new-id> (e.g., /x/warehouse-transfer/WT000001)
- Success indicator: Page shows heading with Transfer ID and buttons like "Confirm", "Cancel", "Ship", "Receive"

## Selector Notes
- From Location combobox defaults to HEADQUARTERS
- To Location combobox needs to be different from From Location
- "Create To Location" option in the To Location combobox opens a drawer to create a new location inline
- The inline location create requires: Location Name, Address (with autocomplete), City, Postal Code, Country

## Common Failures
- From and To locations must be different (validation error: "From and To locations must be different")
- If only one location exists, inline create via "Create To Location" may not reliably auto-select the new location after creation. Better to create the location separately via /x/resources/locations/new first, then reload the transfer form.
- The address autocomplete (combobox labeled "Address Line 1") requires selecting a suggestion to auto-fill City, State, Postal Code, and Country
