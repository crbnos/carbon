# Defense UAS demo dataset (ISR-4 Tactical Quadcopter)

> Status: approved (autonomous mode, 2026-10-26)
> Author: Aashu (with Claude, autonomous mode)
> Date: 2026-10-26
> Research: `.ai/research/2026-10-26-defense-dataset-codebase.md`, `.ai/research/2026-10-26-defense-dataset-domain.md`

## TL;DR

- Add a 5th demo dataset, `defense`, for a defense drone maker. Its hero product is the ISR-4 Tactical Quadcopter.
- The ISR-4 is our own CadQuery model (139 parts). We bake it through the local assembler, like the other four models.
- Two small seed-format additions make the story real: a per-party address country, and per-item custom field values.
- A foreign customer's draft sales order shows the "US-only" export rule blocking the ISR-4 system.
- The four existing datasets do not change. No schema change, apart from one `industry` catalog row.
- The README and landing-page hero swap is a separate follow-up project. It needs this dataset seeded first.

## Reading of the request (autonomous mode)

| Question | Reading |
|---|---|
| What | A full demo company that sells, buys, builds, inspects and ships ISR-4 drone systems, with the drone as its 3D assembly instruction. |
| Why | A prospect from a defense ERP background must see a story with no "fake" signals: export classes, serials, NDAA sourcing, CLIN-style contract lines, MRB. |
| Where | `packages/database/src/datasets/` (data, types, two tiers), one migration, the onboarding icon map, bundled assets. |
| Who | Sales demos, onboarding ("Use a demo template"), Settings → Demo Data, and `pnpm db:seed:dev --dataset defense`. |

## Problem Statement

- Carbon ships four demo datasets: satellite, robotics, precision and motor (`datasets/index.ts:34-39`). None is a defense manufacturer.
- The satellite dataset has one defense customer and an ITAR rule (`data/satellite/foundation.ts:243`, `data/satellite/items.ts:951`). A defense buyer still sees a space company.
- Every customer and supplier gets one shared country (`tiers/01-foundation.ts:384`, `:441`). So an export rule can never fire in a demo.
- A custom field spec has no per-item value (`types.ts:2069-2075`). So the ECCN field on satellite parts is always empty.

## Goals

1. A 5th dataset `defense` that passes the pure validator and the apply-and-rollback check (`pnpm db:check:datasets -- --dataset defense`).
2. The same volume as satellite: every `COVERAGE` status set and every `COVERAGE_FLOORS` floor met, and at least 18 jobs.
3. The ISR-4 air vehicle as the dataset's assembly instruction, with sub-assemblies on two levels.
4. Export class, country of origin and NDAA compliance visible on every part page.
5. One foreign customer whose draft order shows the export rule violation.

## Non-Goals

- The README and `www` landing-page hero swap. It is a follow-up project after this dataset lands.
- ITAR mode (`CONTROLLED_ENVIRONMENT`), ITAR attestations and the audit log. These are deployment-wide or cannot be seeded (research §4).
- New ERP features: no FAI module, no certificate-of-conformance PDF, no contract/CLIN tables, no export-control columns.
- Changes to the four existing datasets, apart from a type default that keeps them compiling.
- Rentals and leases (no slice field exists).

## Proposed Solution

### 1. The model

1. Keep the generator outside the repo: `/Users/aashu/work/carbon/plans/quad-model/quad.py`.
2. Rename the STEP product names to the BOM `readableId`s in §3 (for example `AFR-100 Airframe`). Every leaf name stays unique.
3. Bake the STEP through a locally built `apps/assembler` (`POST /v1/convert`, `linearDeflection 0.5`, `angularDeflection 0.3`).
4. Commit only `assets/defense_uas/models/isr4-quad.glb` and `isr4-quad.graph.json`.
5. Leave `motion` empty. The player synthesizes each insert path (Autonomous Decision 9).

Budget: GLB ≤ 3.5 MB; 139 leaves, far under the 5,000-part limit (`apps/assembler/src/config.rs:27`).

### 2. Seed-format additions (both optional fields)

| Addition | Type change | Tier change | Default |
|---|---|---|---|
| Party address override | `CustomerSpec.address?` and `SupplierSpec.address?`: `{ addressLine1, city, stateProvince, postalCode, countryCode }` | Tier 01 uses the override when present, else `foundation.partyAddress*` | No override: the four datasets do not change |
| Per-item custom field values | `ItemSpec.customFieldValues?: Record<string, string \| boolean \| number>`, keyed by `CustomFieldSpec.name` | After tier 10 seeds the fields, it writes each value into the item's type-table `customFields` JSON, keyed by the `customField.id` | No values: the four datasets do not change |
| Customer contract number | `SalesOrderSpec.customerReference?`, `SalesStatusOrderSpec.customerReference?` | Tier 04 writes `salesOrder.customerReference` | Omitted: no reference |
| Contract line text (CLIN) | `SalesOrderLineSpec.description?`, `SalesStatusOrderSpec.lineDescription?` | Tier 04 writes `salesOrderLine.description` | Omitted: the item's name |

The validator gets two new rules:

- Each `customFieldValues` key names a `customFields` spec on the item's table.
- An override `countryCode` is two upper-case letters.

### 3. The dataset story

| Aspect | Content |
|---|---|
| Key / label | `defense` / "Defense & Unmanned Systems" |
| Industry row | `defense_uas`, name "Defense & Unmanned Systems", icon `shield` (`LuShield`), sort 5 |
| Company | Halberd Unmanned Systems; plant at Huntsville, AL (`America/Chicago`) |
| Customers (6) | Army Small UAS Program Office (Government – DoD); Special Operations Aviation Command (Government – DoD); Northgate Defense Systems (Prime Contractor); Defense Innovation Pilot Office (Government – DoD, prototype agreement); Nordic Defence Materiel Agency (Foreign Government, `NO`); State Emergency Response Agency (Public Safety, Lead) |
| Suppliers (≥ 11) | One per category: flight controllers, mesh radios, NDAA motors, carbon composites, battery packs, EO/IR gimbals, GNSS/CRPA antennas, machined hinges, harnesses, fasteners, PCB assembly. Status rows: one Inactive, one Pending (a new motor source under qualification), one Rejected (failed an NDAA component audit). One EUR supplier in `DE` (connectors). |
| Top item | `ISR4-SYS` ISR-4 System kit (Serial): 2 × `ISR4-AV` air vehicle, 1 × `GCS-100` ground control station, 1 × `SPK-100` spares kit, 1 × `CASE-200` rugged case |
| Air vehicle BOM (`ISR4-AV`, Serial) | `AFR-100`, `ARM-200` ×4, `PRP-300`, `AVN-500`, `BAT-700`, `COM-800`, `PLD-900`, `LDG-950`, `VNS-850`, `LGT-700`, `TRC-100` (the model's product tree) |
| Serialized buys | flight controller, mission computer, mesh radio, C2 radio, CRPA antenna, battery pack, EO/IR gimbal |
| Lot / shelf life | carbon prepreg (Material, Batch, shelf life), structural adhesive (Consumable, Batch, shelf life), propellers (Batch) |
| Services | Operator training course, depot repair, field service representative day |
| Contracts | Customer PO numbers in a real DoD format (invented values), for example `W58RGZ-26-D-0117 DO 0003`. Sales order lines carry CLIN text: `CLIN 0001 ISR-4 System`, `0002 Spares`, `0003 Training`, `0004 Depot Repair`. |
| Export rule | "ITAR UAS — US ship-to only", severity error, on SO and invoice lines for `ISR4-SYS` and `ISR4-AV`. The Nordic agency's Draft order shows it firing. |
| Custom fields (part) | "Export jurisdiction" (List: ITAR / EAR / EAR99), "USML / ECCN" (Text), "Country of origin" (Text), "NDAA §848 compliant" (Yes/No), "IUID mark required" (Yes/No). Every part has values. |
| Custom field (job) | "First article required" (Yes/No) |
| Quality | Receipt inspection of motors (CoC, NDAA letter, magnet origin); an NCR for a counterfeit-suspect ESC with MRB; a vibration-test NCR on an arm; gauges (torque driver, compass calibration fixture, battery analyzer); risks (single-source CRPA antenna, PRC-origin magnets, foreign export) |
| Change orders | Satellite's six notices, rewritten: a Draft Version on the battery tray, an Implementation Revision on the main harness, a Done New Part for the airframe, a Start notice on the PDB bracket, an Engineering Complete notice that adds a UT delamination scan to the carbon arm receiving plan (linked to the arm NCR), and a Cancelled gimbal ICD change |
| Production | Hero job: 3 × `ISR4-AV` for the Army delivery order, In Progress, Hard Deadline. 21 jobs, copied from satellite's job set |

All names are invented. No real company, person or customer appears.

### 4. The assembly instruction (`ISR4-AV`)

Members sit directly before their header (`packages/viewer/src/subassembly.ts`). Every leaf is installed by exactly one step.

| # | Step | Uses |
|---|---|---|
| 1 | **Propulsion Pods** (sub-assembly): stator bases, bells, caps | — |
| 2 | **Arm Set** (parent sub-assembly): hinges, pins, knobs, carbon arms, motor mounts, nav lights, fit the pods | 1 |
| 3 | **Avionics Bay** (sub-assembly): flight controller, mission computer, datalink and C2 radios, PDB, ESCs | — |
| 4 | **EO/IR Gimbal** (sub-assembly): dovetail slide, dampers, pan and tilt motors, yoke, sensor ball, lenses | — |
| 5 | **Landing Gear** (sub-assembly): brackets, struts, skids, caps | — |
| 6 | Set the frame plate in the build stand | |
| 7 | Fit the arm set | 2 |
| 8 | Integrate the avionics bay | 3 |
| 9 | GPS-denied nav kit under the frame | |
| 10 | Lower hull, data plate, encrypted data module | |
| 11 | Upper canopy and nose sensor bezel | |
| 12 | Battery dock | |
| 13 | Comms: CRPA antenna, MANET antennas, C2 whip | |
| 14 | IR strobes and arming switch | |
| 15 | Fit the landing gear | 5 |
| 16 | Quick-release receiver and the gimbal | 4 |
| 17 | Propellers and spinner nuts | |
| 18 | Battery packs | |
| 19 | Final inspection and tethered hover test | |

Member steps split each sub-assembly into 3 to 5 steps, so the instruction has about 40 rows, the same as satellite. Step materials and tools use dataset items (at least 2 materials, 1 tool, 2 part links; research §3).

### 5. Thumbnails

1. Write one SVG per item that satellite also illustrates: about 33 files in `assets/defense_uas/`.
2. Match the existing style: 1024 × 1024 viewBox, gradient fills, no text.
3. Use the satellite SVGs as the style reference.

A missing SVG falls back to the type icon, so a gap never breaks a screen.

### 6. Registration

1. `datasets/types.ts`: add `"defense"` to `DatasetKey`.
2. `datasets/index.ts`: import and register.
3. `tiers/workflow-definitions.ts`: add the builder to `SEED_WORKFLOW_BUILDERS`.
4. Migration `add-defense-industry`: insert the `industry` row with `ON CONFLICT ("id") DO NOTHING`, modelled on `20260813023744_add-aerospace-industry.sql`.
5. `apps/erp/app/routes/onboarding+/industry.tsx`: add `shield: <LuShield …/>` to `INDUSTRY_ICONS`.
6. Docs: `assets/ATTRIBUTION.md` row; `.claude/rules/onboarding-company-templates.md` (five datasets, the icon step, the two new spec fields, floors count 261); `datasets/AGENTS.md`; `packages/database/AGENTS.md`.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Dataset size | Full 5th dataset | User answer |
| Authoring method | Copy satellite's 14 files, then rewrite every record | The three later datasets used this method (research §2); it keeps every coverage set |
| Export rule visibility | Per-party address override | User answer; an optional field keeps four datasets unchanged |
| Export data on parts | Per-item custom field values | User answer; uses the existing `customFields` JSON (`apps/erp/app/utils/form.ts:54-66`) |
| Sale unit | System kit with 2 air vehicles | User answer |
| CLINs and contracts | Text in customer PO numbers and line descriptions | No contract or CLIN table exists; a new one is a product feature, not demo data |
| FAI | Procedure + quality document + job custom field | Precision dataset precedent (`data/precision/foundation.ts:658-709`); no FAI module exists |
| Model source | Original CadQuery model | No clean-licensed military STEP exists; the four existing models are original work |
| Assembler | Build `apps/assembler` locally with Homebrew OpenCASCADE | Documented dev path (`apps/assembler/AGENTS.md`, "Native deps"); node ids need the real converter |
| Industry icon | `shield` → `LuShield` | Exists in the installed `react-icons@5.6.0`; no drone icon exists |
| Hero swap | Separate follow-up project | It needs this dataset seeded and the app recorded |

## Data Model Changes

- One migration: an `industry` catalog row (`defense_uas`). No table or column change.
- Seed types only: `CustomerSpec.address?`, `SupplierSpec.address?`, `ItemSpec.customFieldValues?`.

## Acceptance Criteria

1. `pnpm db:check:datasets -- --dataset defense` exits 0: the validator passes, the dataset applies, all 261 floors pass, and the re-apply over the seeded company passes.
2. `pnpm db:check:datasets` (all five) exits 0, so the four old datasets still pass.
3. `isr4-quad.graph.json` has 139 leaves. `isr4-quad.glb` is at most 3.5 MB.
4. Every graph leaf is named by exactly one step. A local script checks this at bake time.
5. After a seed, the Nordic agency's Draft sales order shows the "ITAR UAS — US ship-to only" violation on the `ISR4-SYS` line.
6. After a seed, the `ISR4-AV` part page shows "Export jurisdiction = ITAR", "USML / ECCN = USML VIII(a)(5) — SME", and "NDAA §848 compliant = Yes".
7. Onboarding lists "Defense & Unmanned Systems" with the shield icon.
8. `pnpm exec turbo run typecheck --filter=@carbon/database` and `--filter=erp` pass. Biome passes on the changed files.

## Open Questions

- [x] How big should this be? — **Answer:** a new 5th dataset (user).
- [x] Should a foreign customer make the export rule fire? — **Answer:** yes, with a seed change (user).
- [x] How do parts show export data? — **Answer:** per-part custom field values, with a seed change (user).
- [x] What does the customer buy? — **Answer:** a system kit (user).
- [x] How are CLINs shown? — **Autonomous:** text in PO numbers and line descriptions — rung 2 (no contract table) and rung 5.
- [x] How are the 33 thumbnails made? — **Autonomous:** hand-written SVG in the satellite style — rung 2 (current assets are SVG code; `assets.ts` accepts only svg, glb and json).
- [x] Where does the assembler come from? — **Autonomous:** local build with Homebrew OpenCASCADE — rung 3 (`apps/assembler/AGENTS.md`).
- [x] Is the hero swap in scope? — **Autonomous:** no, a follow-up — rung 5 (it depends on this dataset).
- [x] Real government organisation names? — **Autonomous:** no; descriptive invented names — rung 1 (the house rule against real names) and rung 5.
- [x] Industry id and icon? — **Autonomous:** `defense_uas` with `shield` — rung 2 (naming like `aerospace_satellite`).
- [x] Motion paths? — **Autonomous:** leave them empty in v1 — rung 3 (motion is optional, research §3) and rung 5 (cost).

## Autonomous Decisions

High-stakes calls first:

1. **Scope cut:** the README and landing-page hero swap is deferred to a follow-up project. It narrows the user's first request.
2. **Seed contract change:** `CustomerSpec.address?`, `SupplierSpec.address?` and `ItemSpec.customFieldValues?` are new optional fields in the shared dataset types.
3. **Global catalog row:** one migration adds the `defense_uas` industry. Every instance gets the row on its next migrate.
4. **Local tooling:** Homebrew installs `opencascade`, and Cargo builds the assembler in release mode. Both are heavy, so they run one at a time after a memory check.
5. CLINs live in text fields, not in a new table.
6. Thumbnails are hand-written SVG in the satellite style.
7. Customer and supplier names are invented and descriptive.
8. The industry is `defense_uas`, labelled "Defense & Unmanned Systems", with the `shield` icon.
9. Motion is left empty in v1. The player synthesizes each insert path. Baking motion needs the satellite-specific script set in `plans/satellite-model/motions/` (12 scripts), which is out of proportion for v1 — rung 5.
10. The spec file is not committed. The user's standing rule forbids a commit without permission, and that rule outranks the skill's commit step.
11. The bake used Homebrew OpenCASCADE 7.9.3; production builds against 8.0.0. Node ids can differ from a production re-convert. This is harmless: the GLB and graph ship together, and the app never re-converts a bundled model — rung 2.
12. **Two more seed fields** (`customerReference`, line `description`) were added during execution: the CLIN text needs a field on the order and on the line. Both are optional — rung 5.
13. **Verification gap:** this checkout's local database was not running, and the run did not start the stack. The stack is heavy, it is shared with other worktrees, and the repo rule leaves database environment changes to the user. Acceptance criteria 1, 2, 5, 6 and 7 are not yet verified against a database — rung 1 and the repo rule.
14. Item prices and costs were re-set to drone values. Every dependent PO, invoice, memo and payment amount was re-balanced until the validator passed — rung 5.
15. The hero job builds 3 air vehicles, not 6. The job set is copied from satellite to keep every validated quantity — rung 2.

## Changelog

- 2026-10-26: Spec written in autonomous mode after four user answers.
- 2026-10-26: Follow-up: database checks passed for all five datasets (closes Decision 13); the README and landing-page hero swap was done after all (reverses the Decision 1 deferral).
- 2026-10-26: Execution: two more optional seed fields (Decision 12); hero job and change orders restated as built; database verification deferred (Decision 13).
