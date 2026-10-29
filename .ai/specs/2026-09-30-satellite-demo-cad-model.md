# Satellite demo CAD model with sub-assemblies

> Status: in-progress (approved 2026-09-30)
> Author: Aashu (with Claude)
> Date: 2026-09-30
> Research: `.ai/research/2026-09-30-satellite-demo-cad-model.md`

## TLDR

Replace the satellite dataset's 3D model (an unrelated radial aircraft engine) with a detailed,
coloured ESPA-class smallsat generated in code, and seed its assembly instruction as a real
multi-level build: three sub-assemblies built on their own, two parent sub-assemblies that
use them, and a final integration that brings everything together into the finished satellite.
It becomes the demo for the sub-assemblies feature on this branch.

## Problem Statement

- `data/satellite/assembly.ts` documents `SAT-1000 ESPA-Class Smallsat Bus` with a radial
  engine model (`radial-engine.glb`); its steps say "Set the crankcase in the stand". It does not
  match the dataset's items, BOMs or story.
- The seed format (`AssemblyStepSpec`, `types.ts:1182-1196`) and `seedAssembly`
  (`tiers/02-items.ts:46-141`) cannot express sub-assemblies (`isSubAssembly`, `parentStepId`,
  `usedInStepId`), so no demo company shows the sub-assembly feature.
- No openly-licensed satellite STEP exists that is clean to ship (`.ai/plans/2026-08-20-demo-cad-models.md`
  "Why aerospace and automotive were hard"), so the model has to be our own work.

## Proposed Solution

### 1. The model (generated, not downloaded)

A CadQuery (Python) script builds the satellite as a STEP assembly with XCAF colours and
product names, then it is baked through a locally built `apps/assembler` `POST /v1/convert`
into `aerospace_satellite/models/smallsat.glb` + `smallsat.graph.json`. The script and bake
helper live **outside the repo** (`/Users/aashu/work/carbon/plans/satellite-model/`); only the
two baked artifacts are committed.

Frame: Z up, bus 600 × 600 × 800 mm, launch adapter ring at −Z, two 3-panel solar wings
**deployed** along ±Y (≈ 4.4 m span). Target 250–450 leaf parts, GLB ≤ 3.5 MB.

STEP product tree (mirrors the SAT-1000 BOM; every product name unique so node ids never
collide — `nodeid.rs:42-48`):

| Product | Contents (leaf parts) |
|---|---|
| `BUS-STR-001 Structural Frame` | launch adapter ring, bottom/mid/top decks, 4 corner longerons, ±X/±Y side panels (±Y with SADA cut-outs), radiator panels, fastener rows |
| `SAW-001 Solar Array Wing +Y` / `−Y` | 3 carbon honeycomb panels each, a GaAs cell blanket per panel (grid-grooved), panel hinges, hold-down brackets, yoke |
| `EPS-001 Power Subsystem` | power tray, `BAT-LIION-48V` battery pack (case + cell modules + terminals), `PCB-EPS-R1` board with components, 2 solar array drive units |
| `ADCS-001 Reaction Wheel Pack` | base plate, pyramid bracket, 4 × `RW-010` wheels (housing, cap, connector), `PCB-ADCS-R1` board, 2 × `ST-050` star trackers with baffles |
| `COMMS-001 Communications` | `TXRX-SBAND` transceiver box, 2 × `ANT-PATCH-01` patch antennas, GPS antenna, coax runs |
| `Avionics Deck` | deck plate, flight-computer card cage and boards |
| `PROP-001 Propulsion Module` | prop deck, cradle, `TANK-TI-4L` tank, 4 × `VLV-SOLENOID-LP` valves, filter, pressure transducer, swept feed lines, 2 × `THR-HYDRA-1N` thrusters, fill/drain valves |
| `HARNESS-001 Wiring Harness` | swept cable bundles with connectors |
| `CN-MLI-001 MLI Blankets` | gold thermal blankets over the side panels |

Colours: aluminium structure, gold MLI, deep-blue cells, dark carbon panel backs, green PCBs,
white radiators, black baffles, titanium tank, dark thruster nozzles.

### 2. The build sequence (sub-assemblies)

Play order = `sortOrder`; members sit directly before their header (branch rule,
`packages/viewer/src/subassembly.ts:205-292`). Every leaf is installed by exactly one step, so
the last step shows the whole satellite.

| # | Step | Uses |
|---|---|---|
| **1** | **Solar Array Wings** (sub-assembly, SAW ×2) | — |
| 1.1–1.4 | lay out panels · bond cell blankets · fit panel hinges & hold-downs · fit yokes | |
| **2** | **Reaction Wheel Pack** (sub-assembly, ADCS) | — |
| 2.1–2.5 | base plate & pyramid bracket · 4 reaction wheels · ADCS board · star trackers · wheel spin test | |
| **3** | **Propulsion Module** (sub-assembly, PROP) | — |
| 3.1–3.5 | tank in cradle · valves, filter, transducer · feed lines · thrusters · helium leak check & fill/drain valves | |
| **4** | **Power Subsystem** (parent sub-assembly, EPS) | |
| 4.1–4.4 | power tray & battery · EPS board · drive units + **fit the solar wings** · pigtails & insulation test | 4.3 uses 1 |
| **5** | **Avionics Stack** (parent sub-assembly) | |
| 5.1–5.5 | deck & card cage · **integrate the reaction wheel pack** · S-band transceiver · route harness · continuity check | 5.2 uses 2 |
| 6 | Set the adapter ring and bottom deck in the stand | |
| 7 | Integrate the propulsion module | uses 3 |
| 8 | Erect longerons and mid deck | |
| 9 | Integrate the power subsystem | uses 4 |
| 10 | Integrate the avionics stack | uses 5 |
| 11 | Close out side panels, radiators, top deck | |
| 12 | Antennas and GPS antenna | |
| 13 | MLI blankets | |
| 14 | Final inspection — the complete SAT-1000 | |

Test/inspection steps may name only the small parts they add (covers, caps) or none. Step
`materials`/`tools` use SAT-1000 BOM items (BUS-STR, EPS, ADCS, COMMS, PROP, HARNESS, MLI) and
`TL-TORQUE-J1` / `TL-PROBE-VNA`. Motion stays automatic (DB default `none`); steps list **leaf**
node ids so the viewer synthesises insert motions (`fallback.ts:144-189`) instead of fading.

### 3. Seed format and seeding

`AssemblyStepSpec` gains three optional fields; existing datasets are unaffected:

```ts
key?: string;           // required when another step refers to this one
isSubAssembly?: boolean;// header row: no componentNodeIds, no materials/tools
parent?: string;        // key of the header this step is a member of
usedIn?: string;        // headers only: key of the step that fits this sub-assembly
```

`seedAssembly` inserts steps in order (header rows with `isSubAssembly = true`), builds a
key → id map, then sets `parentStepId` / `usedInStepId` in a second pass (self-FKs point
forward and backward). The pure validator (`validate.ts`, assembly section) adds the branch's
rules without a new package dependency: unique keys; `parent` names a header; members
contiguous and directly before their header; no header has a `parent`; `usedIn` only on
headers, naming a later non-header step that is not its own member; each header used at most
once; headers carry no node ids.

### 4. Clean-up

Delete `radial-engine.glb` / `.graph.json`; replace its `ATTRIBUTION.md` row with an
"original work, generated" row and the bake recipe; update the satellite section of
`.ai/plans/2026-08-20-demo-cad-models.md` and the CAD paragraph of
`.claude/rules/onboarding-company-templates.md` ("three of the four models…").

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Subject | Satellite, not a rocket | Dataset items/BOMs/story are already a satellite; a rocket means rewriting ~6.7k lines |
| Source of geometry | Generated with CadQuery | No clean-licensed satellite STEP exists (demo-cad-models plan); our own work needs no attribution caveats |
| Pipeline | STEP → local assembler `/v1/convert` | Same converter as production, so node ids/graph format are real |
| Sub-assembly tree | 3 leaf sub-assemblies → 2 parents → final | User's stated structure; nesting via `usedInStepId`, the only nesting the branch allows |
| Step node ids | Leaf ids, generated from graph by name | Group ids fade in instead of moving (`AssemblyPlayer.tsx:1680-1734`) |
| Validation of sub-assembly rules | Re-implemented in `validate.ts` | `@carbon/database` must not depend on `@carbon/viewer` (new dependency) |
| Tessellation | Start at `linearDeflection 1.0 / angularDeflection 0.5`; fall back to 2.0 / 1.0 if GLB > 3.5 MB | Finer look where the size budget allows |
| Old model | Deleted | Only the satellite dataset used it |

## Data Model Changes

N/A — no schema change. Uses the branch's existing `isSubAssembly` / `usedInStepId` /
`parentStepId` columns. Only the seed types (`AssemblyStepSpec`) change.

## Acceptance Criteria

1. `smallsat.graph.json` has 250–450 leaves, ≥ 8 distinct colours, and a root whose children
   are the products in the table above; `smallsat.glb` ≤ 3.5 MB.
2. Every graph leaf is named by exactly one step (checked by a local script at bake time).
3. `pnpm db:check:datasets -- --dataset satellite` passes (validator + apply/rollback), and the
   other three datasets still pass.
4. The validator rejects a spec with a member after its header, a header used by its own
   member, and a `usedIn` that points backwards (unit-tested in the validator's test file, if
   one exists; otherwise by a temporary local run).
5. After `pnpm db:seed:dev -- --dataset satellite`, the SAT-1000 assembly instruction in the ERP
   shows sub-assemblies 1–5 with steps 1.1… and "used in" 4.3, 5.2, 7, 9, 10; opening
   sub-assembly 1 plays only the wing parts; step 4.3 carries the wings in; step 14 shows the
   complete satellite with nothing missing.
6. The SAT-1000 job's assembly operation in MES lists no header rows as job steps.
7. No file references `radial-engine`; `@carbon/database` typecheck and Biome are clean.

## Open Questions

- [x] Wings in the finished model — **Answer:** deployed; looks like a satellite in the viewer.
- [x] Commit the generator script? — **Answer:** no; keep it local, commit only `.glb` + graph.
- [x] Old radial-engine model — **Answer:** delete it and its attribution row.
- [x] Part motion — **Answer:** automatic (viewer fallback); no authored motion fields.
- [x] Subject and sub-assembly tree — **Answer:** satellite; SAW / ADCS / PROP → EPS (uses
      wings) and Avionics (uses ADCS) → final (uses PROP, EPS, Avionics); approved in chat.

## Changelog

- 2026-09-30 — draft written after the interview.
- 2026-09-30 — approved. Built: 266 parts, 20 colours, GLB 1.43 MB at 0.5 / 0.3 (under budget,
  so the finer setting was kept). Wings shortened to 540 mm panels so the bus reads at viewer
  framing. Results: every leaf in exactly one step (bake check); `db:check:datasets` passes all
  four; `validate-assembly.test.ts` 5/5; viewer's `validateSubAssemblies` returns no violations
  on the seeded steps, numbering 1–5 / 1.1… with uses at 4.3, 5.2, 7, 9, 10.
