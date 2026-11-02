# Purchasing Material Planning — Supplier filter

Last tested: 2026-10-29
Route: /x/purchasing/planning?location=<locationId>

## Prerequisites
- Dev stack up, migration `20261029080733_purchasing-planning-suppliers.sql` applied.
- Seeded company (satellite dataset): "Manufacturing Plant" lists 20 rows, 5 of
  them with no supplier part ("No Supplier"); "Headquarters" lists 7.
- None of the seeded items has a preferred supplier, so every supplier the
  column shows comes from the earliest supplier part — the case the old
  `preferredSupplierId` filter never matched.

## Expected options (from the database)
```sql
-- per location: the filter's options
SELECT s.name FROM get_purchasing_planning_suppliers(<companyId>, <locationId>, <periodIds>) f
JOIN supplier s ON s.id = f."supplierId";
```
- Manufacturing Plant: CelestialElex, Deep Space RF, Orbital Composites,
  PropTech Solutions, SpaceGrade Fasteners (the company has 11 suppliers).
- Headquarters: CelestialElex, Orbital Composites.

## Steps
### 1. Navigate
Open the route with the plant's location id. Set the viewport to 1680×1000 so
the Supplier column is visible.

### 2. Open the filter
Click the toolbar's "Filter" button, then the option "Supplier". The list must
hold exactly the expected suppliers above, not every supplier of the company.

### 3. Filter
Click the option "SpaceGrade Fasteners" (the OPTION ref from `snapshot -i`, not
a table cell with the same text). URL gains
`filter=defaultSupplierId:eq:<id>`; the header reads "3 rows" (FST-M4-TI,
FST-M6-A286, BRG-6201), each showing SpaceGrade Fasteners.

### 4. Options stay while filtered
Click the active filter pill's value button ("SpaceGrade Fasteners"): all five
options are still listed.

### 5. Other location
Open the route with the Headquarters location: the options are CelestialElex
and Orbital Composites.

### 6. Order drawer
On the plant, click a row's "Order <qty>" button (FST-M4-TI): the drawer's
Supplier row shows SpaceGrade Fasteners — the row's default supplier.

## Selector Notes
- `agent-browser find text "<supplier>" click` hits the table cell and expands
  the row; pick the option's ref from `snapshot -i` instead.
- The filter popover's options are `option "<name>"` in `snapshot -i`.

## Common Failures
- The dev server crashes after `pnpm install` brings new dependencies; restart
  `crbn up`.
