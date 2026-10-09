# Onshape field mapping: fixes from the 2026-10-09 test run

Findings and their impact assessment live in the project notes (T1–T13). Scope: fix T2–T9, T11–T13; T1 (transient) and T10 (Carbon's own behaviour) need no change.

## Changes

- [x] T7. New BOM lines take the component's Sourcing (`push-assembly.ts`, `push-release.ts`): `ItemRow` gains `sourcingType`, from the item read or, for an item created in the push, from the plan. New lines only.
- [x] T11. A Make to Order line points at the component's active make method (as `upsertMethodMaterial` does), for every made component, not only sub-assemblies; the unchanged check compares against that, so a push no longer undoes the cascade. Both push routes.
- [x] T2. Time the assembly Fields read (element metadata, BOM, part metadata); choose the cheaper read that still finds a part of the assembly.
- [x] T6. The review's mapped value lines leave out an item field the interlock does not write (`plan.ts`).
- [x] T3. Values window: a typed value equal to an option or another typed value (case and end spaces ignored) is refused on Apply, with the row marked.
- [x] T4. Values window, Unit of Measure: an unset option that matches a unit by code or name shows that unit ("FOOT · Foot, by name"); nothing stored changes.
- [x] T5. Values window: Carbon value pickers become the searchable Combobox (scrolls inside the dialog).
- [x] T8. Push results count items whose fields were updated; the panel says so.
- [x] T13. A part push row that only relinks says so instead of an empty "Update".
- [x] T9. "Update on every push" fits the control column.
- [x] T12. Fields Refresh asks before throwing away unsaved edits.

## Verification

- [x] Unit tests: plan display filter (T6), Values window pure helpers (T3, T4), the assembly part pick (T2). T11 has no unit test: its code is in the push routes, and the live run covers it.
- [x] `pnpm --filter @carbon/ee typecheck`, `pnpm exec turbo run typecheck --filter=erp`, Onshape tests, Biome.
- [x] Live, same fixture and method as the test run: clear the Workbench items; round 1 assembly push (new); the Update on every push re-push (2b). The Set at creation re-push (2a) is not repeated: no fix touches it; part push from Part Studio 1. Check every item, custom field and BOM line (method, Sourcing, make method pointer) in the database.
- [x] Create one job from WB-100L and check that made parts carry their make methods (T11).
- [x] Report new bugs before fixing any.

## Result

All items done. The live retest found three minor display issues (N1–N3 in the project notes). The release push is not tested; it needs a release in Onshape.
