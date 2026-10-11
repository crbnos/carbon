# Onshape release push: fixes from the release test run

Findings R-1 to R-13 are in the project notes. R-5, R-6 and R-7 are fixed and retested. This plan fixes the rest.

## Changes

- [x] R-10 and R-8. A part number is "released in Carbon" when one of its revisions carries a release link (`release:` mapping). A workspace push then changes nothing on that part: no item fields, no link swap, no model export. The assembly push still writes a changed BOM into a Draft, as now. Status shows "Released" with the revision instead of Linked, Unlinked or Conflict. Loader `loadReleasedRevisions` (`panel-plan-data.ts`); status, part plan and assembly plan take its result.
- [x] R-11. The assembly plan marks a released method `unchanged` when Onshape's lines equal the method's Onshape-owned lines (part number, quantity, order) and nothing is taken over. The review says "no change" and counts no Draft. The assembly push checks the same before `ensureDraftMakeMethod` and makes no Draft for an unchanged method.
- [x] R-13. A released drawing attaches to the model item it depicts. The part-number match is the first rule. Else the plan reads the release package (`getReleasePackageItems`) and takes the model listed under the drawing, in the release or already in Carbon at that revision. A release with drawings only is accepted.
- [x] R-9. A release push reuses the change notice an earlier push of the same release made, while that notice is still Draft. Otherwise it makes a new notice.
- [x] R-12. The result names the change notice with the revisions and new items it holds, and lists BOM children it created separately.
- [x] R-1, R-2. Result copy: singular and plural, no zero counts, and "BOMs refreshed" only when an assembly is in the release.
- [x] R-3. Refresh on the Releases tab clears the previous push results.
- [x] R-4. The review says that a custom field change on a new revision applies to every revision, because Carbon keeps custom fields per part.

## Verification

- [x] Unit tests for every pure change (released state, unchanged method, drawing match, result copy).
- [x] ee and ERP typecheck, Onshape tests, Biome.
- [x] Live: workspace part and assembly pushes on released parts; an unchanged released sub-assembly; a drawing release; one release pushed from two documents; result copy; Refresh.
- [x] Live, not tested before: the panel at Onshape's panel width, dark theme, the Onshape V2 settings page, a user without settings permission.
- [x] Report new bugs before fixing any.
