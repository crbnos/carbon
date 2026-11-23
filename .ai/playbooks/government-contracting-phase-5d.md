# Government Contracting Phase 5d (R&D tax: work country, funded research, §174A, Section G)

Last tested: 2026-10-12
Routes: /x/resources/locations/new, /x/projects/labor-categories/<id>,
/x/project/<projectId>/element/<elementId>, /x/contract/<id>/details, /x/timesheet,
/x/projects/reports/rd-section-174a, /x/projects/reports/rd-form-6765-g

## Prerequisites
- Satellite dataset company. `timekeepingControls = 'DCAA'` (the element page's Government
  contracting group, with the Business component switch, shows only in DCAA mode).
- Unfunded project for qualified time: NovaSat Gen-3 Bus Qualification (IR&D). Direct project
  with a contract for funded research: ORBSEC Constellation Block 2 / CON000004 (Cost Plus lines,
  so Default already reads funded).
- The employee (test user) has `employeeJob.locationId` = Manufacturing Plant (US).

## Steps
### 1. Location in Germany
- Resources → Locations → "Add Location". Location Name "Munich R&D Center", Address Line 1
  (an address-autocomplete combobox: fill, then click another field to close suggestions), City,
  Postal Code. Country combobox → type "Germany" → pick. Timezone combobox → "Berlin".
- requestSubmit the drawer form ("Save"). `location.countryCode = 'DE'`.

### 2. Labor category role
- Projects → Labor Categories → Design Engineer. "Research role" select → Direct Research.
- The Save button is outside the form: `b.form.requestSubmit(b)`.

### 3. Business components
- Element page → Government contracting group → switch "Business component (R&D)" (saves on
  click). Then the Component type select directly under it → Product / Process.
- Marked: NSG3-3 Product, NSG3-6 Product, NSG3-19 Process, OB2-6 Product (funded).

### 4. Funded research
- Sales → Contracts → CON000004 → properties panel, group "RESEARCH (R&D TAX)" → "Funded research"
  select → Funded (saves on change; `customerContract.researchFunded = true`).

### 5. Time with defaults
- My Time → Add row → Charge Number NSG3-3 → Labor category defaults to Design Engineer →
  "More" shows Work location = Manufacturing Plant (job location) and Research role =
  Direct Research (category role). Add, enter 8 on today's cell (fill + Enter).
  The saved entry has `workLocationId` = plant, `rdActivityRole` = Direct Research.
- Add row NSG3-3 again, More → Work location "Munich R&D Center" → 2 h (row label shows
  "· Munich R&D Center · Direct Research").
- Rows NSG3-6 4 h, NSG3-19 1 h, OB2-6 3 h.
- Submit week → check "I certify this statement" → "Certify and submit". Toast
  "Week submitted and posted" (entries post).

### 6. Reports (tax year 2026)
- Projects → Reports → R&D Tax → §174A R&E: NSG3-3 Foreign $170.00 (2 h × $85 at Munich);
  OB2-6 "Of Which Funded" = its total. CSV `/api/projects/reports/rd-section-174a.csv?taxYear=2026`.
- Form 6765 Section G: rows in descending Total QRE (NSG3-3 $1,960, NSG3-6 $767), then
  "Aggregate of 1 business components" ($192, NSG3-19), then Total. OB2-6 (funded) has no row.
  CSV `/api/projects/reports/rd-form-6765-g.csv?taxYear=2026`, aggregate row named
  "Aggregate Business Components".

## Selector Notes
- Element pages opened by URL are often not hydrated: `reload`, wait ~25 s, and confirm the
  switch actually flipped (read the DB or re-snapshot) before moving on.
- Report cards are links; the first click sometimes only re-renders the list — click again.

## Common Failures
- The aggregate needs at least 3 components with QRE where the top ones reach 80 % of the total.
- Entries without a work location count as "Unknown Country" in §174A and are excluded from
  Section G ("Hours excluded for an unknown work country").
