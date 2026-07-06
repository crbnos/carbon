# Create Depreciation Run

Last tested: 2026-06-07
Route: /x/accounting/depreciation-runs

## Prerequisites
- At least one fixed asset should exist (though the run can be created even with no active assets)
- Navigation: The depreciation runs page is not in the accounting sidebar by default; navigate directly via URL

## Steps

### 1. Navigate
- URL: /x/accounting/depreciation-runs
- Expected: "Depreciation" heading with "Run Next Period" button and a list of existing runs

### 2. Open confirmation dialog
- Click "Run Next Period" button
- Expected: Modal dialog with heading "Run Next Period" and text explaining the period end date (e.g., "This will create a draft depreciation run for the period ending Jun 30, 2026. All active assets will be calculated automatically.")

### 3. Submit
- Button: "Create Run" in the dialog
- Wait 3 seconds for redirect

### 4. Verify
- Expected redirect: /x/depreciation-run/<new-id> (detail page)
- Success indicator: Page shows heading with run ID (e.g., "DR000002"), status badge "DRAFT", "Period End" date, and a table of assets
- If no active assets exist, table shows "No assets to depreciate for this period."
- "Post Run" button is available to finalize

## Selector Notes
- "Run Next Period" button appears at top of the list and also in the empty state
- The confirmation dialog has "Cancel" and "Create Run" buttons
- The dialog auto-calculates the next period end date based on fiscal year settings

## Common Failures
- If all periods have already been run, the behavior may differ
- Fixed assets in DRAFT status are not included; they need to be registered/active first
- The depreciation runs page is at /x/accounting/depreciation-runs, not /x/accounting/depreciation
