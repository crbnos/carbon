# MES Step Reference Images (shop-floor work instructions)

Last tested: 2026-07-30
App: MES
Route: /x/operation/:operationId  (standard, non-Assembly operation view)

Verifies that reference images ("slides") attached to a Bill of Process step render
as thumbnails on the MES operation Details/Procedure Steps list, and open in the
fullscreen ImageZoomViewer on click. Component: `StepsListItem`
(`apps/mes/app/components/JobOperation/components/Step.tsx`).

## Prerequisites
- A make part whose method has an operation with a **non-Assembly, non-Inspection**
  process (so the standard operation view renders, not AssemblyView/InspectionView).
- That operation's step has ≥1 `methodOperationStepSlide` with a real `imagePath`
  in the `private` bucket.
- A job created for that item (job creation runs the `get-method` edge function,
  which copies method slides → `jobOperationStepSlide`).

## Fast seed (when the dev DB is empty)
1. ERP UI: create Make part; create a Process (processType **Process**); add a method
   operation using that process; the step can be seeded directly.
2. Upload a real PNG to the private bucket via storage REST (service role):
   `POST {SUPABASE_URL}/storage/v1/object/private/{companyId}/parts/<name>.png`.
3. DB: insert `methodOperationStep` (type `Task`) + `methodOperationStepSlide`
   rows (`"imagePath"` = the uploaded path; `annotations` `'[]'::jsonb`).
4. ERP UI: create a Job for the item (route /x/job/new) → materializes
   `jobOperation` + `jobOperationStep` + `jobOperationStepSlide`.
5. Get the job's operation id from `jobOperation` and open it in MES.

## Steps
### 1. Navigate — MES `/x/operation/<jobOperationId>`
### 2. Verify thumbnails
`[...document.querySelectorAll('img')].filter(i=>i.src.includes('/file/preview/private/'))`
— expect one per image slide; each `naturalWidth > 0` (actually loaded, not broken).
### 3. Click a thumbnail (button aria-label = slide caption or "Reference image N")
→ ImageZoomViewer opens: an enlarged img + the caption + a Close (X) button.
### 4. Close (X) → viewer dismisses.

## Selector Notes
- Thumbnail buttons carry `aria-label` = the slide `caption`.
- Image URLs are `/file/preview/private/{companyId}/parts/...` (getPrivateUrl).
- Viewer image is the same src rendered large (bounding width ≈ natural size).

## Common Failures
- **500 "annotations.map is not a function"**: `get-method` persists copied slide
  `annotations` as a non-array JSON value (`{}`) on `jobOperationStepSlide`. Guarded
  in `StepsListItem` by normalizing with `Array.isArray(...)` before passing to the
  viewer. (Root-cause data bug in `get-method` still open — separate follow-up.)
- Operation redirects to Assembly/Inspection view → the process type wasn't
  `Process`; those op types use different components that already render slides.
- Broken image (naturalWidth 0) → `imagePath` points at a missing object in the
  `private` bucket.
