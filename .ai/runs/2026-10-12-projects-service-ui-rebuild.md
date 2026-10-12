# Projects and Service UI rebuild — run log

Plan: `.ai/plans/2026-10-12-projects-service-ui-rebuild.md`. Screenshots go to `.ai/scratch/ui-rebuild/` (git-ignored). Viewport 1440×900. User `satellite-demo@carbonos.dev` at https://erp.projects-wbs-research-spec.dev.

## Task 1: Set up the screenshot scripts, the run log and the baseline shots

- The scripts `login.sh` and `shot.sh` exist and are executable. The browser session `ui-rebuild` was already signed in, so `login.sh` printed `LOGIN FORM NOT FOUND` and the URL `/x`.
- 22 baseline shots `00-*.png` are saved. The inventory count reference is `00-ref-inventory-count.png` (count `ic_8L6hmHD9ykkCuj9GvKYiTR`).
- `/x/project/…/elements` opens with `?layout=list` (the saved layout preference).
- No error text showed on any baseline screen.

## Task 2: Apply the terminology table and add the glossary entries

## Task 3: Give Empty a title and a description

- `Empty` takes `title` and `description`. `description={null}` renders no line. The default text is the same.
- Code gate: Biome clean, `typecheck --filter=erp` exit 0, `erp test` 2,242 passed.
- `03-empty-unchanged.png` matches `00-project-costs.png` pixel for pixel by eye. The 7 questions do not apply: the task changes no layout.

## Task 4: Add ReadOnlyField for read-only values

## Task 5: Add the grid helpers EditableByRow and useStableEditableComponents

## Task 6: Add collapsible groups and counts to the sidebars

## Task 7: Add useGovernmentContracting and UpgradeOverlayRow

## Task 8: Fix the week views on a Sunday

## Task 9: Shrink the Projects and Service sidebars (Layer 0)

## Task 10: Simplify the projects list and the New Project drawer (Layer 1)

## Task 11: Build the project workspace shell and the project sidebar (Layer 2)

## Task 12: Rebuild the project header on RecordHeader

## Task 13: Add the project Overview page

## Task 14: Fold Details into the project Settings page

## Task 15: Simplify the Costs page

## Task 16: Rebuild the Stock, Pegging and Billing pages under Costs

## Task 17: Simplify the Time page

## Task 18: Turn Milestones into the Schedule page

## Task 19: Reduce the Plan loader to Table, Tree and Reader

## Task 20: Give Plan one toolbar row and add rows in the grid

## Task 21: Delete the List, Board and Timeline layouts

## Task 22: Restyle the Tree cards and fix the fit-view

## Task 23: Rebuild the element panel and page (Layer 4)

## Task 24: Put all plan lines in one grid

## Task 25: Rebuild ERP My Time as a grid

## Task 26: Rebuild MES My Time as a touch grid

## Task 27: Rebuild Approvals with Time and Billing tabs

## Task 28: Edit labor category rates in a grid

## Task 29: Edit contract labor rates, funding actions and rate ceilings in grids

## Task 30: Fix My Visits, the Build from part drawer and the Service empty states

## Task 31: Open New Service Order in a drawer

## Task 32: Give service templates a standard record page

## Task 33: Show a locked contract line as read-only text

## Task 34: Rebuild Projects → Reports as one list

## Task 35: Turn Indirect Rates into a runs list with a Rates drawer

## Task 36: Move Burden Settings to Settings → Accounting and default the fiscal year

## Task 37: Match Settings → Timekeeping and Projects to Settings → Inventory

## Task 38: Sweep the remaining empty states

## Task 39: Sweep every boolean field to bordered

## Task 40: Sweep the glossary popovers onto the rebuilt screens

## Task 41: Update the rules, AGENTS.md, lessons and the design skill

## Task 42: Update the docs reference pages

## Task 43: Fill the translations

## Task 44: Run the final screenshot pass

