# Demo CAD models for the four onboarding datasets

Goal: one openly-licensed multi-part CAD assembly per industry dataset, so a demo company has
something real to open in the 3D viewer and in the assembler.

## Status

**Done and verified (2026-08-20).** All four models are baked, committed, and seeded by
`tiers/06-production.ts`. Verified: `pnpm db:check:datasets` passes all four, `@carbon/database`
typechecks, biome is clean, a fresh company seeds the rows correctly, and re-applying a second
dataset onto the same company wipes and replaces the model with no orphans.

Baked total is **6.8 MB** for the four (robot arm 0.56, extruder toolhead 1.34, radial engine
2.15, EV drive unit 2.72), at `linearDeflection: 2.0` / `angularDeflection: 1.0`. At the default
0.1 the same four are 46 MB. Quality at the coarse setting was reviewed on screen and approved.

The assembler CAN be built locally — that was the original blocker and it is resolved:
`apps/assembler/scripts/build-occt.sh` (~15 min, cached at `~/.cache/carbon-occt/8.0.0-p1`),
`brew install cmake ninja fcl draco eigen`, then
`OCCT_PREFIX=$HOME/.cache/carbon-occt/8.0.0-p1 cargo build --release -p assembler` and
`ASSEMBLER_DEV_MODE=true ./target/release/assembler` (listens on :8000).

## The four picks

All verified by downloading the file and counting `PRODUCT` / `NEXT_ASSEMBLY_USAGE_OCCURRENCE`
entities — no part count below is inferred from a title.

### robotics_oem — Koch low-cost robot arm (BEST OF THE FOUR)
- 5-DOF 3D-printed arm, the design LeRobot/SO-100 forked from
- `https://raw.githubusercontent.com/AlexanderKoch-Koch/low_cost_robot/main/hardware/follower/step/arm.step`
- License: `MIT License` / `Copyright (c) 2024 Alexander Koch` (repo-wide, no hardware carve-out)
- 38 distinct parts, 126 instances, 2,470,516 bytes
- Caveat: embeds ROBOTIS Dynamixel vendor CAD (`XL-430_new`, `XL,XC-330`). MIT covers Koch's work,
  not the servo solids he redistributed. Low risk, worth one sanity check.

### precision_manufacturing — Jubilee Bondtech groovemount extruder toolhead
- Toolchanger extruder head; 40 parts, English names, the only candidate that landed inside
  15-60 parts AND under 20 MB
- `https://raw.githubusercontent.com/machineagency/jubilee/main/tools/jubilee_tools/tools/extruders/direct_drive_bondtech_groovemount_extruder/cads/STEP/bondtech_groovemount_extruder.STEP`
- License: `"Jubilee (c) by Joshua Vasquez / Jubilee is licensed under a Creative Commons
  Attribution Attribution 4.0 International License."` OSHWA-certified US002091.
- 40 products / 71 occurrences, 17,615,342 bytes → 1.34 MB baked, 70 components
- Caveat: embeds McMaster-Carr vendor part models.
- Rejected alternative: **E-moc X5** 5-axis mill (CC BY 4.0, 8.7 MB) — better subject, but it
  explodes to **1,445 components**, far too many for a demo parts list, and its part names are
  Japanese `\X2\`-escaped.

### automotive_precision — Chevrolet Bolt EV drive unit
- EV traction drive internals: rotor shaft, reduction gears, differential, 6208/6307/6308 bearings
- https://borealisdata.ca/dataset.xhtml?persistentId=doi:10.5683/SP3/LM35Z2
- Download: `https://borealisdata.ca/api/access/datafile/986548` → zip; STEP is
  `Chevrolet Bolt Drive Unit CAD data/3D CAD files/Bolt_Drive_Unit_CAD_STEP.stp`, 17,529,819 bytes
- License: repository metadata says `CC0 1.0` (`rightsIdentifier: CC0-1.0`); the bundled
  `README.txt` says `CC BY 4.0`. Both acceptable, so the conflict is harmless.
- 26 distinct parts, 42 instances, 52 solids
- **Two real caveats.** No stator and no housing — this is the rotating group only. And it is a
  reverse-engineered teardown of a GM production product by McMaster University; the authors
  certify it is IP-clean, but design-right exposure is a business call the CC0 grant does not
  settle. **Get a yes on this one before shipping it.**
- Safe fallback: `spot-v1` RC car, `MIT License / Copyright (c) 2025 Aidan`,
  https://github.com/aidanahn/spot-v1 — 40 STEP files, 4,918,047 bytes total. Clean but it is a
  3D-printed RC car, and there is no single assembly file (40 loose parts).

### aerospace_satellite — Radial aircraft engine
- 53 components: master rod, crankshaft, crankcase, engine head/barrel, valves, rocker arms, cams
- `https://raw.githubusercontent.com/SivakumarThirumurugan/Radial-Engine/main/Radial%20Engine.STEP`
- License: `MIT License` / `Copyright (c) 2026 Sivakumar Thirumurugan`
- 53 solids, 201 instances, 61 unique product names, 13,389,913 bytes
- Caveats: it is an aircraft engine, not a satellite — aerospace, but off-theme. Provenance is
  thin (solo repo, 1 star; the `01-`…`53-` naming suggests a follow-along tutorial model).

## Why aerospace and automotive were hard

Not a weak search — a structural gap. Open satellite and automotive CAD is either copyleft
(GPL / CC-BY-SA, which would infect a commercial product) or vendor CAD that a university
relicensed without owning it. Specifically ruled out: NASA 3D Resources (zero STEP files
anywhere), `nasa/open-source-rover` (STEP files are all third-party PCB components),
`spel-uchile/CAD_SUCHAI_II` (MIT applied over ISISPACE + GomSpace vendor geometry — stated
license does not match chain of title), `raffdp/GearBoxDemo` (README admits the geometry came
from GrabCAD), `simscape/Wheel-Loader-Simscape` (MathWorks field-of-use restriction), Onshape
public documents (visible, not licensed), MakerWorld (its own terms forbid redistributing STEP).

## What was actually built

1. `assets.ts` — a second `import.meta.glob` for `./assets/**/models/*.{glb,json}`, merged with
   the artwork map. **Both the pattern and the options object must stay inline literals**; vite
   reads them statically and hoisting either into a `const` fails the dev server with
   `Invalid glob import syntax: Expected the second argument to be an object literal, but got "Identifier"`.
2. `types.ts` — `AssemblySpec` / `AssemblyStepSpec`, exposed as an OPTIONAL
   `ProductionData.assembly` so a dataset with a null `industryId` stays valid.
3. `data/<key>/assembly.ts` — one per dataset, wired into that dataset's `production.ts`.
   Step `componentNodeIds` are generated from the bundled `graph.json`, never hand-written.
4. `tiers/06-production.ts` — `seedAssembly()` writes the `modelUpload`, the
   `assemblyInstruction` (Published), its steps, and points `item.modelUploadId` at the model.

The `modelPath` shape constraint noted during research (`<companyId>/models/<id>.<ext>`, because
`modelIdFromPath` recovers the id from the string) was deliberately NOT satisfied: the id is
generated by the DB and `modelUpload`'s PK is `id` alone, so baking a fixed id into the filename
would collide on the second company seeded. The consequence is contained — the assembly page
reads `glbPath`/`graphPath` directly through `getPrivateUrl` and is unaffected. Only the item
CAD card's artifacts lookup derived a phantom id.

**Fixed 2026-08-20.** `CadModel`'s `modelPath` prop was replaced by `modelUpload?: ModelUpload`
(`apps/erp/app/types`), the shape the surfaces already had — the component reads `modelPath` and
`modelId` off it and forwards both to `useOptimizedModel`, which already preferred an explicit id
over path derivation (MES has always passed one). Passing them as one object is the point: a path
without its id is what derived the phantom id, and that is now unrepresentable rather than merely
fixed at 14 call sites. Note the id the surfaces expose is `modelId` — the `COALESCE`d id that
pairs with the `modelPath` they render — NOT the line's own `modelUploadId` FK, which is null
whenever the model is inherited from the item. `getModelByItemId` returns that same shape flat
(one branch, every field null when there is no model) and `getModelByQuoteLineId` now just
resolves the line's item and delegates to it. The purchasing-RFQ line details loader calls it
directly because `purchasingRfqLines` is the one view exposing `modelPath` without an id. This
also fixes legacy rows whose stored path isn't `${companyId}/models/${id}.ext`.

## Verification run

- `pnpm db:check:datasets` — all four pass
- `pnpm exec turbo run typecheck --filter=@carbon/database` — clean
- `pnpm exec biome check packages/database/src/datasets` — clean (13 pre-existing warnings)
- Seeded a fresh company, confirmed the rows in Postgres, rendered the model in the browser
- Re-applied a second dataset onto the same company: one model row, no orphans

## Re-baking

If a model is ever re-baked, **the step `componentNodeIds` in `data/<key>/assembly.ts` MUST be
regenerated from the new `graph.json`**. `nodeId` is a hash of the tessellated geometry, so any
change to the mesh — including a different `linearDeflection` — invalidates every stored id, and
the steps will silently animate nothing.
