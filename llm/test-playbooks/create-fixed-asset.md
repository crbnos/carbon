# Create Fixed Asset

Last tested: 2026-06-07
Route: /x/accounting/fixed-assets (via "Add Fixed Asset" button)

## Prerequisites
- At least one asset class must exist (seeded by default: BUILDINGS, MACHINERY & EQUIPMENT, VEHICLES)

## Steps

### 1. Navigate
- URL: /x/accounting/fixed-assets
- Expected: Fixed Assets list page with "Add Fixed Asset" button

### 2. Open form
- Click "Add Fixed Asset" button
- Expected: Modal dialog with heading "New Fixed Asset"

### 3. Fill form
- Field "Name" (textbox): Required. Enter asset name (e.g., "Test CNC Machine")
- Field "Asset Class" (combobox, labeled "Select"): Click to open, select from list (e.g., "MACHINERY & EQUIPMENT"). This auto-fills depreciation method and useful life from the asset class defaults.
- Field "Description" (textbox): Optional
- Field "Serial Number" (textbox): Optional
- Field "Depreciation Method" (combobox): Auto-filled from asset class (e.g., "Straight Line")
- Field "Useful Life (Months)" (textbox with spinbutton): Auto-filled from asset class (e.g., 120 for MACHINERY & EQUIPMENT)
- Field "Salvage Value" (textbox with spinbutton): Defaults to 0
- Field "Cost Center" (combobox, labeled "Select"): Optional

### 4. Submit
- Button: "Save" in modal footer
- Wait 3 seconds for redirect

### 5. Verify
- Expected redirect: /x/fixed-asset/<new-id> (detail page)
- Success indicator: Page shows heading with asset ID (e.g., "FA000002"), status badge "DRAFT", summary showing Acquisition Cost, Accum. Depreciation, and Net Book Value (all $0.00 initially)
- Toast notification: "Fixed asset created"
- Detail fields show Name, Asset Class, Depreciation Method, Useful Life, Residual Value

## Selector Notes
- Name is the first textbox in the modal
- Asset Class is the first combobox (labeled "Select")
- Selecting an asset class auto-updates the Depreciation Method and Useful Life fields
- The modal has Save and Cancel buttons at the bottom

## Common Failures
- Name and Asset Class are both required; form won't submit without them
- If no asset classes exist, you need to create one first via /x/accounting/asset-classes
