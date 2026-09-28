# First Article Inspection (AS9102) — release blocker, generation, MES execution, verify/approve

Last tested: 2026-09-26
Routes: /x/settings/quality, /x/production/inspection(/new), /x/inspection-document/{id}, /x/part/{itemId}/quality,
/x/job/new, /x/job/{id}/details, /x/quality/first-articles, /x/first-article/{faiId},
MES /x/operation/{opId}, MES /x/first-article/{inspectionId}, MES /x/end/{opId}

## Prerequisites
- A Make part (revision) with no Approved FAI and a single-level BOM (satellite seed: PCB-EPS-R1, which
  already has one plan "EPS-CTL-200 Rev D" on its Flying probe test op).
- Login: see certificate-of-conformance.md "Login note" (magic-link workaround). MES shares the cookies.

## Steps
### 1. Company switch
- /x/settings/quality → card "First Article Inspection" → switch "Require first article for new parts and
  revisions" → requestSubmit that card's form ("Save"). The switch alone does not persist.
- WARNING: with it on, releasing ANY job whose make-method item has 0 or 2+ plans and no FA slot is blocked.

### 2. Second plan (for the blocker case) with MMC
- /x/production/inspection/new → Part combobox, Drawing Number, Drawing revision → requestSubmit "Create"
  → redirects to /x/inspection-document/{id}.
- "Add Feature" adds a grid row; click a cell to get its editor (textbox or combobox), `fill`, press Enter.
  Units is a combobox (Inch, not mm). Type column is a combobox (Measurement, Checkbox, …).
- MMC feature: Material condition = MMC, Size feature = the size row's label, Feature of size = Internal.
- Click the toolbar "Save" button (not a form) → rows persist with designator/referenceLocation/etc.

### 3. Blocker (Case A)
- /x/job/new → Item → requestSubmit "Save". Job header shows "FAI due".
- Release → dialog lists "Missing First Article Plans — <part>" and "Release Job" is disabled. The part
  link goes to /x/part/{itemId}/quality.

### 4. Assign slot and release
- Part Quality tab → "Inspection Plan Assignments" → second select (First Article) → pick plan →
  requestSubmit that form (inputs intent=assignment, usage=First Article).
- Job → Release → requestSubmit "Release Job" → status Ready, header chip "FAI open", a
  `First Article` inspection (lotSize 1) + `firstArticleInspection` Draft row; listed at
  /x/quality/first-articles.

### 5. MES
- MES /x/operation/{any op of the job} → banner "First article required for <part>" → Inspect →
  /x/first-article/{inspectionId}.
- Numeric cells: fill the cell's textbox, press Tab (saves quietly). MMC cell shows
  "allowable Y (bonus X)". Checkbox rows: click the "Pass" BUTTON ref — clicking the cell centre hits Fail.
- Note: the row's "Add note"/"Edit note" button → textbox "Add a note to this reading" → Save.
- Accept (header) → dialog "Accept first article?" → requestSubmit Accept → lot Passed.

### 6. ERP FAI detail
- /x/first-article/{faiId}: Form 1 (editable inputs + Save while Draft), Form 2 (lineage rows; untracked
  materials show "Missing"), Form 3 (Ref. location, designator, requirement with Ⓜ, results incl. bonus text
  and the note). The page scrolls inside a container — use `scrollIntoView` on the "Form 2"/"Form 3" headings.
- Verify (no dialog) → toast "First article verified". Approve → dialog "Approve first article?" warns
  "You verified this first article. AS9102 recommends a different approver." → requestSubmit Approve.
- PDF: /file/first-article/{faiId}.pdf — 3 landscape pages (841×595), no DRAFT when Approved.
- After approval Form 1 inputs are disabled; a direct POST to /x/first-article/{id}/header (needs `id`
  in the form data) changes nothing.
- ⋮ More options → "Customer Approval" → name + date (date segments: click month, type MMDDYYYY) →
  requestSubmit Save → toast "Customer approval saved".

### 7. Inspection-system guards
- MES /x/end/{opId} for an Inspection op → redirects to /x/inspection/{opId}, posts no quantity. The
  inspection view creates the op's lot and starts a labor timer on open — pause it ("Pause timer").
- Plan editor: row ⋮ → Delete a feature that has readings → toolbar Save → toast
  `Feature "<label>" has recorded results and cannot be deleted`, row restored. Deleting the SIZE feature of
  an MMC row is stopped earlier by the client ("Choose the size feature for MMC/LMC characteristics").

## Common Failures
- Part revision "0" is printed as "N/C" on Form 1 (the CofC prints "0" for the same kind of item).
- `getCertificateTypeLabel` renders empty labels (Attach Certificate type select, Form 2 kind).
