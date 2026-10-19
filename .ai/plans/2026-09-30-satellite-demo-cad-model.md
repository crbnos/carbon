# Satellite demo CAD model — implementation plan

**Spec / source:** `.ai/specs/2026-09-30-satellite-demo-cad-model.md`
**Research:** `.ai/research/2026-09-30-satellite-demo-cad-model.md`
**Branch:** `feat/sub-assemblies` (worktree `/Users/aashu/work/carbon/carbon-feat-sub-assemblies`)
**Local (uncommitted) tooling dir:** `/Users/aashu/work/carbon/plans/satellite-model/` (`$SM` below)

Rules: `pnpm` only; never commit (the user commits); nothing from `$SM` goes into the repo.

## Progress
- [x] Task 1: Local tooling — CadQuery venv, assembler build, Redis
- [x] Task 2: Generator — `satellite.py` → `smallsat.step` + `steps.json`
- [x] Task 3: Bake — `bake.py` → `smallsat.glb` + `smallsat.graph.json`
- [x] Task 4: Visual review + CHECK-IN with the user
- [x] Task 5: Seed types — sub-assembly fields on `AssemblyStepSpec`
- [x] Task 6: `seedAssembly` writes headers, `parentStepId`, `usedInStepId`
- [x] Task 7: Validator — sub-assembly rules + tests
- [x] Task 8: `data/satellite/assembly.ts` — the new build sequence
- [x] Task 9: Remove the radial engine; attribution + docs
- [ ] Task 10: Verification (typecheck, lint, tests, dataset check, seed + browser walk)

## Dependencies
1 → 2 → 3 → 4 → 8. 5 → 6, 5 → 7 (5–7 independent of 1–4). 8 needs 3, 5. 9 needs 8. 10 last.

---

## Task 1: Local tooling

**Depends on:** none
**Steps:**
1. `mkdir -p $SM && /opt/homebrew/bin/python3.11 -m venv $SM/.venv && $SM/.venv/bin/pip install cadquery`
2. `OCCT_PREFIX=$HOME/.cache/carbon-occt/8.0.0-p1 cargo build --release -p assembler` from the worktree root
   (precedent: `.ai/plans/2026-08-20-demo-cad-models.md:17-21`).
3. Redis: `redis-cli -u redis://localhost:6379 ping`; if not running, use the one `crbn up` starts
   (`packages/dev/src/services/apps.ts:290-318` for the URL) or `docker run -d -p 6379:6379 redis:7`.
**Verify:**
```bash
$SM/.venv/bin/python -c "import cadquery; print(cadquery.__version__)"   # prints a version
ls target/release/assembler                                            # exists
```
If the cargo build fails on OCCT or a brew dep, STOP and report.

## Task 2: Generator

**Depends on:** 1
**Files:** Create `$SM/satellite.py` (local only).
**Steps:**
1. Build a `cq.Assembly` named `SAT-1000 ESPA Smallsat` whose children are the products in the
   spec's product table, each with a unique name, colours from the spec, Z up, mm.
2. Every leaf part gets a unique name and is tagged with the step key that installs it (the
   14 main steps + members 1.1–5.5 of the spec's sequence table). Write `$SM/out/steps.json`:
   `{ "<stepKey>": ["<leaf name path>", ...] }`.
3. Export `$SM/out/smallsat.step` via `assy.save(..., exportType="STEP")` (keeps names/colours).
**Verify:**
```bash
$SM/.venv/bin/python $SM/satellite.py && grep -c "NEXT_ASSEMBLY_USAGE_OCCURRENCE" $SM/out/smallsat.step
# Expected: 250–450-ish usages; script prints leaf count and "every leaf tagged once"
```

## Task 3: Bake

**Depends on:** 2
**Files:** Create `$SM/bake.py` (local only).
**Steps:**
1. Start a throwaway HTTP server on 127.0.0.1 that serves `$SM/out/smallsat.step` on GET and
   writes PUT bodies to `$SM/out/`.
2. Run `ASSEMBLER_DEV_MODE=true PORT=8765 REDIS_URL=<url> target/release/assembler`; POST
   `/v1/convert?sync` with body `{source:{url}, outputs:{glb:{path:"smallsat.glb"},graph:{path:"smallsat.graph.json"}}, options:{linearDeflection:1.0, angularDeflection:0.5}}`
   and header `X-Carbon-Upload-Urls` pointing at the PUT server (`main.rs:309-340, 771-794`).
3. If the GLB is > 3.5 MB, re-run at 2.0 / 1.0.
4. Resolve `steps.json` to node ids by walking the graph by name path; write
   `$SM/out/step-node-ids.json`; assert every graph leaf appears in exactly one step.
**Verify:**
```bash
ls -la $SM/out/smallsat.glb $SM/out/smallsat.graph.json   # GLB ≤ 3.5 MB
# bake.py prints: leaves N (250–450), distinct colours ≥ 8, "all leaves covered once"
```

## Task 4: Visual review + CHECK-IN

**Depends on:** 3
**Steps:** Render the STEP to PNGs (iso, front, top; e.g. CadQuery SVG export → `qlmanage -t`)
and look at them; fix obvious ugliness in Task 2 and re-bake. Show the user the images.
**CHECK-IN with the user before Task 8.**

## Task 5: Seed types

**Depends on:** none
**Files:** Modify `packages/database/src/datasets/types.ts` — `AssemblyStepSpec` (1182-1196):
```ts
  /** Needed when another step names this one in `parent` / `usedIn`. Unique per assembly. */
  key?: string;
  /** A sub-assembly header row: names no node ids, materials or tools. */
  isSubAssembly?: boolean;
  /** Key of the header this step is a member of. Members sit directly before their header. */
  parent?: string;
  /** Headers only: key of the later main-or-member step that fits this sub-assembly. */
  usedIn?: string;
```
**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/database` → no errors.

## Task 6: `seedAssembly`

**Depends on:** 5
**Files:** Modify `packages/database/src/datasets/tiers/02-items.ts` (`seedAssembly`, 76-100).
**Steps:** In the step loop also write `isSubAssembly: step.isSubAssembly ?? false`, and record
`idByKey.set(step.key, stepId)` when `key` is set. After the loop, for each step with `parent`
or `usedIn`, `UPDATE "assemblyInstructionStep" SET "parentStepId" = $1 / "usedInStepId" = $1
WHERE id = $2 AND "companyId" = $3` with ids from `need(idByKey, key)`-style lookup (throw
`Seed: assembly step "<title>" names unknown key "<key>"`). Keep one UPDATE per linked step
(≤ 30 rows; not an N+1 over user data).
**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/database` → no errors.

## Task 7: Validator

**Depends on:** 5
**Files:** Modify `packages/database/src/datasets/validate.ts` (`assembly`, 3831+); Create
`packages/database/src/datasets/validate-assembly.test.ts` (precedent: `wipe.test.ts` for vitest
style).
**Steps:** Add, inside the graph branch, rules with messages prefixed `items.assembly step "<title>"`:
unique keys; header has no `componentNodeIds`/materials/tools and no `parent`; `parent` names a
header; each header's members are contiguous and end directly before it; `usedIn` only on
headers, names a non-header step later in the list that is not one of its own members; no two
headers share a `usedIn`… (allowed: one step may use several headers). Tests: clone
`satellite` (`structuredClone`) and assert `validateDataset` returns `[]` for the real data and a
matching message for (a) a member after its header, (b) `usedIn` on its own member, (c) `usedIn`
pointing to an earlier step, (d) unknown `parent`.
**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/datasets/validate-assembly.test.ts
# Expected: all pass (after Task 8 lands the real satellite data)
```

## Task 8: Satellite assembly data

**Depends on:** 3, 4, 5
**Files:** Modify `packages/database/src/datasets/data/satellite/assembly.ts`; copy
`$SM/out/smallsat.{glb,graph.json}` to `packages/database/src/datasets/assets/aerospace_satellite/models/`.
**Steps:** `model: "smallsat"`, `name: "ESPA Smallsat — Integration Sequence"`, `item: "SAT-1000"`,
`componentCount` from the graph, `operation: 1`. Steps in the spec's play order with keys
(`sa-wings`, `sa-rwa`, `sa-prop`, `sa-eps`, `sa-avionics`, …), node ids from
`step-node-ids.json`, realistic instructions, materials (BUS-STR-001 at 6, PROP-001 at 7,
EPS-001 at 9, ADCS-001 at 5.2, COMMS-001 at 5.3, HARNESS-001 at 5.4, CN-MLI-001 at 13) and tools
(TL-TORQUE-J1 on torque steps, TL-PROBE-VNA at 12). `componentMappings`: ≥ 3 leaf hashes →
BUS-STR-001 (adapter ring), PROP-001 (tank), CN-MLI-001 (a blanket), plus any others on the
SAT-1000 BOM tree (validator uses `componentsOf`, the whole tree).
**Verify:** `pnpm db:check:datasets -- --dataset satellite` → passes.

## Task 9: Remove the radial engine; docs

**Depends on:** 8
**Files:** Delete `assets/aerospace_satellite/models/radial-engine.{glb,graph.json}`; modify
`assets/ATTRIBUTION.md` (replace the row; add "original work, generated with CadQuery, baked at
<deflection>"; fix "Three of the four"), `.ai/plans/2026-08-20-demo-cad-models.md` (satellite
section → superseded note), `.claude/rules/onboarding-company-templates.md` (CAD paragraph).
**Verify:** `grep -rn "radial-engine" packages .claude apps --include=*.ts --include=*.md --include=*.json | grep -v node_modules` → no hits.

## Task 10: Verification

**Depends on:** all
**Steps:**
1. `pnpm exec turbo run typecheck --filter=@carbon/database`; `pnpm exec biome check packages/database/src/datasets`;
   `pnpm --filter @carbon/database exec vitest run src/datasets`.
2. `pnpm db:check:datasets` (all four).
3. Seed a satellite company (`pnpm db:seed:dev -- --email <user's dev email> --dataset satellite`
   — ask the user which email), open the SAT-1000 assembly instruction in the ERP, walk spec
   acceptance criteria 5 and 6 with screenshots.
**Verify:** each command exits 0; record results in the spec changelog.
