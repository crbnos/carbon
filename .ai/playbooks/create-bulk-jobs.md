# Create Bulk Jobs

Last tested: 2026-06-06
Route: /x/job/new (then click "Many Jobs" tab)

## Prerequisites
- At least one manufactured item must exist (e.g., "M000000001 Manufactured")

## Steps

### 1. Navigate
- URL: /x/job/new
- Click the "Many Jobs" tab (second tab, next to "Single Job")
- Expected: "Bulk Jobs" form with Item, Total Quantity, Quantity Per Job, Scrap Quantity Per Job, dates, location, deadline type

### 2. Fill form
- Field "Item" (combobox): Click to open, select "M000000001 Manufactured"
- Field "Total Quantity" (textbox): Defaults to 1
- Field "Quantity Per Job" (textbox): Defaults to 1
- Field "Scrap Quantity Per Job" (textbox): Defaults to 0
- Due Date of First Job: Optional
- Due Date of Last Job: Optional
- Location: Defaults to HEADQUARTERS
- Deadline Type: Defaults to "Low Priority No Deadline"

### 3. Submit
- Button: "Save"

### 4. Verify
- Expected redirect: /x/job (jobs list page)
- Success indicator: Jobs list shows the newly created job(s) with status "DRAFT"
- A toast notification appears confirming creation

## Selector Notes
- Must click "Many Jobs" tab first; the default is "Single Job"
- The "Many Jobs" tab URL does not have a separate route; it's a tab within /x/job/new
- Item combobox shows both manufactured and purchased items (unlike Single Job which filters)
- Total Quantity / Quantity Per Job determines how many jobs are created (Total / PerJob = number of jobs)

## Common Failures
- If no items exist, only "Create Item" option appears
- The form redirects to the jobs LIST page, not a single job detail page
