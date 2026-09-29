# BoP Preview — slide annotation pin alignment

Last tested: 2026-09-18
Route: /x/part/{itemUuid}/manufacturing → operation drawer → Preview tab
Component: apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx (OperationPreview)

## What it verifies
Annotation pins in the read-only Preview map to the RENDERED image box (not a
letterboxed aspect-video frame). Regression guard for the fix that wraps the
preview image in `relative inline-block` (mirrors SlideAnnotator).

## Prerequisites
- A make-method operation with a step that has an IMAGE slide carrying pins.
- Demo DBs often have operations but no steps/slides — seed one:
  - insert methodOperationStep (type 'Task') on an existing methodOperation
  - insert methodOperationStepSlide with imagePath + annotations (pins at known
    fractions, e.g. corners 0.05/0.95 + center 0.5). A bundled dataset asset
    path like `_templates/aerospace_satellite/ADCS-001.svg` renders via
    getPrivateUrl with NO storage object needed.
  - clean up both rows afterwards.

## Steps
1. Open the part, Manufacturing tab, click the operation → Preview tab.
2. Measure pins vs image box with agent-browser eval: for each absolute pin
   span, compare its center as a fraction of the sibling <img> getBoundingClientRect
   to its style.left/top. PASS = actual % equals stored % (within ~0.5%).

## Result (2026-09-18)
img 520x520; pins 5%/95%/50% expected == actual exactly. PASS.

## Notes
- Screenshots via agent-browser hang on dev HMR; the eval-based numeric check is
  the reliable verification here.
- The company with operations may differ from the login-default company; check
  methodOperation.companyId and switch if needed.
