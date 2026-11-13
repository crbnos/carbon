# First Article Inspection (AS9102) — release blocker, generation, MES execution, verify/approve

Last tested: 2026-11-11
Routes: /x/settings/quality, /x/quality/inspection-plans(/new), /x/inspection-document/{id}, /x/part/{itemId}/quality,
/x/job/new, /x/job/{id}/details, /x/quality/first-articles, /x/first-article/{faiId}, /x/first-article/new?jobId={jobId},
/x/inspection/{lotId}, MES /x/operation/{opId}, MES /x/job/{jobId}, MES /x/first-article/{inspectionId}, MES /x/end/{opId}

## Prerequisites
- A Make part (revision) with no Approved FAI and a single-level BOM (satellite seed: PCB-EPS-R1, which
  already has one plan on its Flying probe test op).
- Login: see certificate-of-conformance.md "Login note" (magic-link workaround). MES shares the cookies.
- Use `--session <name>` on every agent-browser command when another session is testing in parallel.

## Plan versions (read first)
- A plan is Draft, Active or Archived; each version is its own `inspectionDocument` row. Only a Draft is
  editable. Publish archives the old Active version and moves the slot assignments to the new one.
- The release blocker and the generator count **Active** versions only. A part whose plan has a Draft
  second version still has one plan; a First Article slot that points at a Draft resolves nothing.
- A lot keeps the version it was created on: publishing V1 does not move an open FAI off V0.

## Steps
### 1. Company switch
- /x/settings/quality → card "First Article Inspection" → switch "Require first article for new parts and
  revisions" → requestSubmit that card's form ("Save"). The switch alone does not persist.
- WARNING: with it on, releasing ANY job whose make-method item has 0 or 2+ Active plans and no FA slot is
  blocked. A customer's Shipping tab "Requires First Article" switch does the same for its jobs — turn it
  back off afterwards.

### 2. Second plan (for the blocker case) with MMC
- /x/quality/inspection-plans/new opens a drawer. `click @ref` inside it can close the drawer: use real
  mouse events (`mouse move x y`, `mouse down`, `mouse up`) on its controls and the submit button.
- "Add Feature" adds a grid row; click a cell to get its editor (textbox or combobox), `fill`, press Enter.
  Units is a combobox (Inch, not mm). Type column is a combobox (Measurement, Checkbox, …).
- MMC feature: Material condition = MMC, Size feature = the size row's label, Feature of size = Internal.
- Click the toolbar "Save" button (not a form) → rows persist with designator/referenceLocation/etc.
- New version: Active plan → New version → a Draft copy; edit, then Publish. The copy's MMC row must name
  the COPY of its size feature (`sizeFeatureId`), else the editor refuses to save.

### 3. Blocker (Case A)
- /x/job/new → Item → Save. Job header shows "FAI due".
- Release → dialog lists "Missing First Article Plans — <part>" and "Release Job" is disabled. The part
  link goes to /x/part/{itemId}/quality. Bulk release (jobs table) and batch release refuse the same job.
- Edge: give the part's plan a Draft second version → the dialog must NOT list it.

### 4. Assign slot and release
- Part Quality tab → "Inspection Plan Assignments" → second select (First Article) → pick plan →
  requestSubmit that form (inputs intent=assignment, usage=First Article).
- Job → Release → "Release Job" → status Ready, header chip "FAI open", a `First Article` inspection
  (lotSize 1, every feature n = 1, on the Active version) + `firstArticleInspection` Draft row; listed at
  /x/quality/first-articles.

### 5. MES
- MES /x/operation/{any op of the job} and /x/job/{jobId} → banner "First article required for <part>" →
  Inspect → /x/first-article/{inspectionId}. A part with no Active plan shows "First article plan missing".
- Numeric cells: fill the cell's textbox, press Tab (saves quietly). MMC cell shows
  "allowable Y (bonus X)". Checkbox rows: click the "Pass" BUTTON ref — clicking the cell centre hits Fail.
- Note: the row's "Add note"/"Edit note" button → textbox "Add a note to this reading" → Save.
- Accept (header) → dialog "Accept first article?" → Accept → lot Passed. Accept is disabled while a
  reading failed.
- Reject → dialog lists the failed features, "Open an NCR for MRB disposition" (checked) + Issue Type →
  Reject → lot Failed, readings and both buttons disabled, one NCR linked to the lot
  (`nonConformanceInspection`) and to the make method's first operation. The FAI stays Draft (Verify is a
  separate step).
- One-shot: a replayed POST to the closed lot redirects with an error and opens no second NCR.

### 6. ERP FAI detail
- /x/first-article/{faiId}: Form 1 (editable inputs + Save while Draft; Drawing Number is left blank — the
  plan name is not a drawing), Form 2 (lineage rows; untracked materials show "Missing"), Form 3 (Ref.
  location, designator, requirement with Ⓜ, results incl. bonus text and the note). The page scrolls
  inside a container — use `scrollIntoView` on the "Form 2"/"Form 3" headings.
- Verify (no dialog) → toast "First article verified". Approve → dialog "Approve first article?" warns
  "You verified this first article. AS9102 recommends a different approver." → Approve.
- PDF: /file/first-article/{faiId}.pdf — 3 landscape pages (841×595), no DRAFT when Approved; the stored
  file does not change after later plan edits.
- After approval Form 1 inputs are disabled; a direct POST to /x/first-article/{id}/header (needs `id`
  in the form data) changes nothing.
- ⋮ More options → "Customer Approval" → name + date (date segments: click month, type MMDDYYYY) →
  Save → toast "Customer approval saved".
- Job deleted: /x/first-article/new?jobId={draft job} → Create (a real mouse click; `requestSubmit` on that
  drawer form did nothing) → delete the job (POST /x/job/{id}/delete) → the FAI shows "Job deleted", keeps
  its Form 1 snapshot, and Refresh from Traceability, Attach Certificate, Verify are disabled. Delete the
  test FAI afterwards (POST /x/first-article/delete/{faiId}).

### 7. ERP measurement grid (/x/inspection/{lotId})
- Layout radio "By characteristic" / "By part"; the choice persists in localStorage
  `carbon:inspection-grid-layout`.
- The reading cell's note button sits in the cell's top-left corner. A click in the cell centre must open
  the value editor, not the note.
- MMC: typing a size reading re-valuates the dependent cell (bonus); a size reading that removes the bonus
  fails the dependent.
- Paste: dispatch a `paste` ClipboardEvent (DataTransfer `text/plain`, tabs and newlines) on a cell.
  By part: rows are parts, columns characteristics; By characteristic: the reverse. A bad token and
  columns past the last characteristic are skipped; toast "Results recorded: N. Values skipped: M."
  (poll for the toast within ~4 s).

### 8. Inspection-system guards
- MES /x/end/{opId} for an Inspection op → redirects to /x/inspection/{opId}, posts no quantity. The
  inspection view creates the op's lot and starts a labor timer on open — pause it ("Pause timer").
- Plan editor: row ⋮ → Delete a feature that has readings → toolbar Save → toast
  `Feature "<label>" has recorded results and cannot be deleted`, row restored. Deleting the SIZE feature of
  an MMC row is stopped earlier by the client ("Choose the size feature for MMC/LMC characteristics").
- An Active or Archived plan version is read-only in the editor.

## Common Failures
- Part revision "0" is printed as "N/C" on Form 1 (the CofC prints "0" for the same kind of item).
- `getCertificateTypeLabel` renders empty labels (Attach Certificate type select, Form 2 kind).
- A flash toast set by a full-document load (for example the kanban scan route) is never shown:
  `flashClientMiddleware` only reads flashes on client navigations. Check the job status instead.
