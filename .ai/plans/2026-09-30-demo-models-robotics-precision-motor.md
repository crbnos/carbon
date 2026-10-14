# Generated demo models (robotics, precision, motor) — implementation plan

**Spec / source:** `.ai/specs/2026-09-30-demo-models-robotics-precision-motor.md`
**Precedent:** `.ai/plans/2026-09-30-satellite-demo-cad-model.md` (done)
**Branch:** `feat/sub-assemblies` (worktree `/Users/aashu/work/carbon/carbon-feat-sub-assemblies`)
**Local tooling (uncommitted):** `/Users/aashu/work/carbon/plans/satellite-model/` (`$SM`)

Rules: `pnpm` only; never commit; nothing from `$SM` goes into the repo.

## Progress
- [x] Task 1: Shared tooling — `cadlib.py`; `bake.py` / `gen_assembly.py` take a model name
- [x] Task 2: `robot.py` → `robot-arm-6ax` (working pose, controller cabinet)
- [x] Task 3: `hpu.py` → `hpu-manifold`
- [x] Task 4: `motor.py` → `servo-motor-9000`
- [x] Task 5: Bake all three; every leaf in one step; sizes/colours in budget
- [x] Task 6: Visual check-in with the user (one page, all three)
- [x] Task 7: Step definitions + generated `assembly.ts` for robotics, precision, motor
- [x] Task 8: Delete old models; ATTRIBUTION, rule doc, old plan
- [x] Task 9: Verification

## Dependencies
1 → (2, 3, 4) → 5 → 6 → 7 → 8 → 9.

---

## Task 1: Shared tooling
**Files (local):** Create `$SM/cadlib.py` (colours, `put`/`sub`/`attach_all`, `box`/`cyl`/`tube`/
`orient`/`at`/`screw_row`/`perimeter`, `shaded`/`snap`, `export(root, model, views)`); make
`bake.py` take `<model>` and write `out/<model>/…`; make `gen_assembly.py` take `<model>` and read
its step table from `$SM/steps_<model>.py` (the satellite table moves to `steps_smallsat.py`).
**Verify:** re-run satellite: `satellite.py`, `bake.py smallsat 0.5 0.3`, `gen_assembly.py smallsat`
→ `git diff --stat packages/database/src/datasets/data/satellite/assembly.ts` shows no change.

## Tasks 2–4: Generators
Each script builds the spec's product tree with unique part names, tags each leaf with a step key
(`s<sub>_<n>` for members, `m<n>` for main steps), writes `out/<model>/<model>.step`,
`steps.json`, and renders `iso`, `iso-back`, `inside` (outer shells hidden) and one PNG per
sub-assembly. Target 150–450 leaves, ≥ 8 colours.
**Verify:** each script prints its leaf count and passes the `sum(1 for _ in root) == leaves`
assertion; the PNGs look right on inspection.

## Task 5: Bake
`bake.py <model> 0.5 0.3` for each (2.0 / 1.0 if > 3.5 MB).
**Verify:** prints `all leaves covered once`, 0 duplicate node ids, GLB ≤ 3.5 MB.

## Task 6: Check-in
One local page `$SM/preview-all.html` with every render; `open` it; wait for the user.

## Task 7: Seed data
Write `$SM/steps_<model>.py` (spec's sub-assembly tables, realistic instructions, materials
from each product's BOM, tools named in the spec, ≥ 2 component mappings to BOM items);
`gen_assembly.py <model>` writes `data/<key>/assembly.ts`; copy GLB + graph into
`assets/<industryId>/models/`.
**Verify:** `pnpm db:check:datasets` passes all four; the viewer-rules script
(`scratchpad/check-sub.ts`, generalised to take a dataset key) prints no violations and the
expected numbering/uses for each.

## Task 8: Clean-up
Delete the three old `.glb`/`.graph.json`; rewrite `assets/ATTRIBUTION.md` (all models original,
bake settings, generator not committed); update the CAD paragraph of
`.claude/rules/onboarding-company-templates.md`; mark `.ai/plans/2026-08-20-demo-cad-models.md`
superseded.
**Verify:** `grep -rn "robot-arm\"\|extruder-toolhead\|ev-drive-unit" packages .claude apps --include=*.ts --include=*.md` → no hits.

## Task 9: Verification
`pnpm exec tsgo --noEmit` in `packages/database`; `pnpm exec biome check packages/database/src/datasets`;
`pnpm --filter @carbon/database exec vitest run src/datasets`; `pnpm --filter @carbon/viewer exec vitest run`;
`pnpm db:check:datasets`. Record results in the spec changelog.
