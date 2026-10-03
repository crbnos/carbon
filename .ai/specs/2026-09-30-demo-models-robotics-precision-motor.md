# Generated demo models for robotics, precision and motor

> Status: implemented (approved 2026-09-30)
> Author: Aashu (with Claude)
> Date: 2026-09-30
> Precedent: `.ai/specs/2026-09-30-satellite-demo-cad-model.md` (same pipeline, done)
> Research: `.ai/research/2026-09-30-demo-models-boms.txt` (BOM trees of the three products)

## TLDR

Give the other three demo datasets the same treatment as the satellite: a detailed, coloured
model generated in CadQuery that matches each dataset's own product and BOM, baked through the
local assembler, seeded as a build with sub-assemblies. Each product gets a **different**
sub-assembly shape, chosen to fit how that product is really built. The three third-party
models are deleted.

## Problem Statement

- The robotics, precision and motor datasets ship third-party models that do not match their
  products: a hobby robot arm for a six-axis industrial arm (`ROB-2000`), a 3D-printer extruder
  for a hydraulic power unit manifold (`HMA-4000`), and a GM drive-unit teardown for a servo
  motor (`MTR-9000`).
- Two of them carry licence caveats (embedded vendor CAD; a teardown of a production product —
  `ATTRIBUTION.md` "Known caveats").
- None of them demonstrates sub-assemblies.

## Proposed Solution

Same pipeline as the satellite: CadQuery script → STEP with XCAF colours and BOM-shaped product
tree → `apps/assembler /v1/convert` (0.5 / 0.3, fall back to 2.0 / 1.0 if a GLB exceeds 3.5 MB)
→ `<model>.glb` + `.graph.json` → generated `data/<key>/assembly.ts` with leaf node ids.
Every leaf in exactly one step; last step shows the finished product. Tooling stays local in
`/Users/aashu/work/carbon/plans/satellite-model/` (shared helpers split out of `satellite.py`,
`bake.py` / `gen_assembly.py` parameterised by model).

### 1. Robotics — `ROB-2000` Vertex 10 six-axis arm → `robot-arm-6ax`

Industrial arm on a pedestal in a **working pose** (elbow bent, wrist down, gripper open), with
the controller cabinet beside it. Arm built from joint modules, so sub-assemblies are wide and
shallow: four built on their own, one parent that uses **two**, and one that is **not used by any
step** — it joins the main build where it sits ("joins main build").

| Sub-assembly | Contents (BOM) | Used in |
|---|---|---|
| 1 J2 Joint Drive | servo motor, harmonic gear, encoder, housing (`DRV-J2-MOD`) | 3.x |
| 2 J3 Joint Drive | same, second module (`DRV-J2-MOD`) | 3.x |
| 3 Link Assembly | lower + upper links, crossed-roller bearings (`ARM-LINK-001`) | main |
| 4 Three-Axis Wrist | 3 × 200 W motor, gear, encoder, housings (`ARM-WRIST-001`) | main |
| 5 Gripper | jaws, F/T sensor, motor (`GRP-2F-80`) | main (last) |
| 6 Controller Cabinet | cabinet, 6 servo drives, control + I/O boards (`CTRL-100`) | joins main build |

Main: pedestal + J1 base & column (`ARM-BASE-001`) → fit link assembly → fit wrist → route arm
harness (`HRN-ARM-001`) → fit gripper → covers (`CN-COVER-KIT`) → controller joins → burn-in
check. Tools `TL-TORQUE-M1`, `TL-BACKLASH-J1`.

### 2. Precision — `HMA-4000` hydraulic power unit manifold → `hpu-manifold`

Welded base frame carrying a pump-and-manifold module, a hydraulic cylinder on a test stand,
hoses and an enclosure. Built **deep**: valves go into the manifold, the manifold goes into a
module with the pump, the module goes onto the frame (three levels).

| Sub-assembly | Contents (BOM) | Used in |
|---|---|---|
| 1 Valve Cartridge Stack | spools, die springs, O-rings, end caps (`ASM-VALVE-SUB`) | 3.x |
| 2 Pump Cartridge | pump housing, drive shaft, bearings, dowels (`MCH-HSG-PUMP`, `MCH-SHAFT-DR`) | 4.x |
| 3 Manifold Assembly | manifold block, flanges, spacers, gauge ports — **uses 1** (`MCH-MANI-BLK`) | 4.x |
| 4 Pump & Manifold Module | adapter plate — **uses 3 and 2** | main |
| 5 Actuator | cylinder, piston rod, bushings, clevis (`CYL-HYD-40`, `MCH-PISTON-ROD`) | main |

Main: base frame (`FAB-BASE-WLD`) → fit pump & manifold module → fit actuator → hoses and
fittings → enclosure panels (`FAB-ENCL-PNL`) → proof test. Tools `TL-VISE-6IN`, `TL-FIXT-HSG`.

### 3. Motor — `MTR-9000` TD-9000 servo motor → `servo-motor-9000`

Cast-finned housing with feet, front flange, end bells, fan cowl, terminal box and nameplate;
cut-away-free (a solid motor, parts inside). Built as a **chain**: magnets onto the core, the core
onto the shaft; stator and terminal box on their own.

| Sub-assembly | Contents (BOM) | Used in |
|---|---|---|
| 1 Wound Stator | lamination stack, 12 coils, slot liners (`STA-9000`) | main |
| 2 Magnet Rotor Core | rotor lamination stack, 24 magnet segments, retaining sleeve | 3.x |
| 3 Rotor Assembly | shaft, bearings, balance rings — **uses 2** (`ROT-9000`, `SHF-9000`) | main |
| 4 Terminal Box | box, 6-pole terminal block, gland, lid (`TRM-BOX-9000`) | main |

Main: housing (`HSG-9000`) → press stator in → drive-end bell + seal → insert rotor → non-drive
end bell → encoder (`ENC-INC-2048`) → fan + cowl (`FAN-AX-160`) → terminal box →
nameplate (`NPL-SS-STD`). Tools `TL-ARBOR-PRESS`, `TL-BAL-MANDREL`.

### Clean-up

Delete `robot-arm`, `extruder-toolhead`, `ev-drive-unit` `.glb` + `.graph.json`. With no
third-party model left, `ATTRIBUTION.md` becomes a short note that every bundled model is
original generated work (with the bake settings). Update `.claude/rules/onboarding-company-templates.md`
(CAD paragraph) and mark the 2026-08-20 plan superseded.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sub-assembly shape | Different per product (wide / deep / chain) | User asked for variety that fits each product |
| Uses per step | Robot link uses two drives; HPU module uses two sub-assemblies | Exercises "a step may use several" |
| Unused sub-assembly | Robot controller joins main build | Shows the second mode of the feature |
| Depth | HPU three levels | Exercises recursive carry-in (`subAssemblyPartIds`) |
| Seed format | No change — `key` / `isSubAssembly` / `parent` / `usedIn` from the satellite work | Already supports all of the above |
| Old models | Deleted | User choice; removes licence caveats |
| Pacing | Build all three, one visual check-in, then integrate | User choice |

## Data Model Changes

N/A — seed data and assets only.

## Acceptance Criteria

1. Each new GLB ≤ 3.5 MB, about 150–450 leaves, ≥ 8 colours; every leaf in exactly one step.
2. `pnpm db:check:datasets` passes all four; the viewer's `validateSubAssemblies` returns no
   violations for each dataset's seeded steps, with the numbering and uses listed above.
3. `validate-assembly.test.ts` still passes; `@carbon/database` typecheck and Biome clean.
4. No references to the deleted model files remain.

## Open Questions

- [x] Old models — **Answer:** replace and delete.
- [x] Build trees — **Answer:** vary them per product; decide what makes sense for each (above).
- [x] Robot pose — **Answer:** working pose.
- [x] Pacing — **Answer:** all three, then one check-in.

## Changelog

- 2026-09-30 — draft written after the interview.
- 2026-09-30 — implemented. robot-arm-6ax 0.76 MB / 161 leaves / 18 colours; hpu-manifold 2.27 MB /
  150 / 17; servo-motor-9000 0.93 MB / 150 / 13; every leaf in exactly one step. In the robot, the
  link assembly uses the two drives in two steps (3.2, 3.4); the HPU's 4.2 uses two sub-assemblies
  in one step. Results: `db:check:datasets` passes all four; viewer `validateSubAssemblies` returns
  no violations for robotics / precision / motor; `@carbon/database` typecheck clean; dataset tests
  8/8, viewer tests 136/136; Biome clean on `datasets/data` and `datasets/assets`.
