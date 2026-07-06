# Create Maintenance Dispatch

Last tested: 2026-06-07
Route: /x/resources/maintenance (via "Add Dispatch" button)

## Prerequisites
- None required; all fields except Location have sensible defaults

## Steps

### 1. Navigate
- URL: /x/resources/maintenance or click "Dispatches" in the Resources sidebar
- Expected: "Maintenance Dispatches" list page with "Add Dispatch" button and location filter combobox

### 2. Open form
- Click "Add Dispatch" button
- Expected: Full-page form with heading "New Maintenance Dispatch" showing Description editor, Priority, Source, Severity, Work Center, Location, OEE Impact, and date fields

### 3. Fill form
- Field "Description" (rich text editor, "Press '/' for commands"): Optional
- Field "Priority" (combobox): Defaults to "Medium"
- Field "Source" (combobox): Defaults to "REACTIVE" with clear button. Optional
- Field "Severity" (combobox): Defaults to "SUPPORT REQUIRED" with clear button. Optional
- Field "Work Center" (combobox, labeled "Select"): Optional
- Field "Location" (combobox): Defaults to "HEADQUARTERS"
- Field "OEE Impact" (combobox): Defaults to "NO IMPACT" with clear button. Optional
- Fields "Planned Start Time" and "Planned End Time" (date pickers): Optional

### 4. Submit
- Button: "Save"
- Note: The standard agent-browser click on Save may not trigger Remix form submission. Use eval to click the submit button: `agent-browser eval "(function(){ document.querySelector('button[type=submit]').click(); return 'ok'; })()"`
- Wait 3 seconds for redirect

### 5. Verify
- Expected redirect: /x/maintenance/<new-id> (detail page, e.g., /x/maintenance/main_xxx)
- Success indicator: Page shows heading with dispatch ID (e.g., "MAIN000001"), status badge "OPEN", "Start" and "Complete" action buttons
- Right sidebar shows PROPERTIES with ID, Status (OPEN), Assignee (Unassigned), Location, Work Center, Priority, Severity, Source
- Left sidebar shows "Items" and "Timecards" sections

## Selector Notes
- The form renders as a full-page route, not a modal
- All combobox fields with "Clear" buttons are optional
- The rich text Description editor accepts plain text or slash commands

## Common Failures
- The Save button may not respond to standard agent-browser click; use eval-based click as noted above
- All form fields except Location have defaults, so the form can be submitted with minimal input
