# Create Job

Last tested: 2026-06-06
Route: /x/job/new

## Prerequisites
- At least one manufactured item must exist (e.g., "M000000001 Manufactured")

## Steps

### 1. Navigate
- URL: /x/job/new
- Expected: "New Job" form with tabs "Single Job" (selected) and "Many Jobs". Form has Item combobox, Change Type button, quantity, scrap quantity, location, date, and deadline type.

### 2. Fill form
- Field "Item" (combobox, labeled "Select"): Click to open, then select "M000000001 Manufactured"
- Field "Quantity" (textbox): Defaults to 1, leave as-is or change
- Field "Scrap Quantity" (textbox): Defaults to 0
- Location defaults to HEADQUARTERS
- Deadline Type defaults to "Low Priority No Deadline"

### 3. Submit
- Button: "Save"
- Note: Save button becomes disabled while submitting. Wait 3-5 seconds for redirect.

### 4. Verify
- Expected redirect: /x/job/<new-id> (e.g., /x/job/J000002)
- Success indicator: Page shows heading with Job ID, buttons like "Release", "Complete", "Cancel", and a tree view of the item's bill of process

## Selector Notes
- Item combobox is the first combobox after the Job ID field
- The form shows "Change Type" button next to the item (for switching between Manufactured/Purchased)
- Quantity and Scrap Quantity are textbox fields with Increase/Decrease buttons
- Location is a combobox defaulting to HEADQUARTERS
- Deadline Type is a combobox

## Common Failures
- If no manufactured items exist, only "Create Item" appears in the combobox
- Save button briefly disables during submission; don't click again
