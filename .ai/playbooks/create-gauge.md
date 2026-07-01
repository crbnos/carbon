# Create Gauge

Last tested: 2026-06-07
Route: /x/quality/gauges (via "Add Gauge" button)

## Prerequisites
- At least one gauge type must exist (seeded by default: BORE GAUGE, CALIPER - DEPTH, etc.)

## Steps

### 1. Navigate
- URL: /x/quality/gauges
- Expected: Gauges list page with "Add Gauge" button in top right and empty state area

### 2. Open form
- Click "Add Gauge" button
- Expected: Modal dialog with heading "New Gauge" and fields for Gauge ID, Description, Gauge Type, Manufacturer, etc.

### 3. Fill form
- Field "Gauge ID" (textbox, labeled "Next Sequence"): Leave as-is for auto-generated ID
- Field "Description" (textbox): Optional
- Field "Gauge Type" (combobox): Click to open, select from list (e.g., "CALIPER - DEPTH")
- Field "Manufacturer" (combobox, labeled "Select"): Optional
- Field "Model Number" (textbox): Optional
- Field "Serial Number" (textbox): Optional
- Field "Role" (combobox): Defaults to "STANDARD"
- Field "Date Acquired" (date): Defaults to today
- Field "Last Calibration Date" (date): Optional
- Field "Next Calibration Date" (date): Optional
- Field "Location" (combobox): Defaults to "HEADQUARTERS"
- Field "Storage Unit" (combobox): Optional
- Number field at bottom (calibration interval in months): Defaults to 6

### 4. Submit
- Button: "Save" in the modal footer
- Wait 3 seconds for redirect

### 5. Verify
- Expected: Returns to gauges list page
- Success indicator: New gauge row appears in the table with generated ID (e.g., "G00001"), type, role, status "ACTIVE", calibration status "PENDING", and location
- Toast notification appears

## Selector Notes
- Gauge Type is the first combobox after the Gauge ID field
- The modal has Save and Cancel buttons at the bottom
- The form is a modal/drawer overlay on the gauges list

## Common Failures
- If Gauge Type is not selected, form may not submit (it's the only required field beyond defaults)
- The "Toggle" button next to Gauge ID toggles visibility of the sequence number
