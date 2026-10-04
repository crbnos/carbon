# Create Demand Forecast

Last tested: 2026-10-04
Route: /x/production/demand-forecasts/new

## Prerequisites
- At least one item and one location exist (any demo dataset has both).

## Steps
### 1. Navigate
- URL: `/x/production/demand-forecasts/new`
- Expected: comboboxes "Item" and "Location", tabs "Wk 1–13" … "Wk 40–52", and
  52 number inputs labelled "Week N (M/D)".

### 2. Fill
- Field "Item" (first combobox, shows "Select"): click, then click an option.
- Field "Location" (second combobox): pre-filled with the user's location.
- Field "Week 1" (first number input): "12". Field "Week 2": "7".
- Click any other week input to blur, so the last value commits.

### 3. Submit
- requestSubmit the form whose submit button reads "Create Forecast" (NOT a click).

### 4. Verify
- Redirect to `/x/production/demand-forecasts?location=<locationId>`.
- The item's row shows the entered weekly values.
- `demandProjection` has one row per non-zero week for the item.

## Selector Notes
- The submit button's text is "Create Forecast" followed by its shortcut hint, so
  match with `includes`, not equality.
- The week labels come from `formatDate` with the Lingui locale; "Week 1 (10/4)"
  is the en-US form.

## Common Failures
- `/x/production/projections/new` is not a route (404). The path is
  `demand-forecasts`.
