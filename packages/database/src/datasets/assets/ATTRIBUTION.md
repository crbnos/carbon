# Demo dataset CAD models

Every `<industryId>/models/*.glb` is original work: a model generated in CadQuery for its
dataset, with a product tree that mirrors that dataset's top-level BOM. None of them is
derived from third-party CAD, so none carries an attribution requirement.

| File | Product | Parts | Dataset |
|---|---|---|---|
| `aerospace_satellite/models/smallsat.glb` | `SAT-1000` ESPA-class smallsat | 266 | satellite |
| `robotics_oem/models/robot-arm-6ax.glb` | `ROB-2000` six-axis arm with controller cabinet | 161 | robotics |
| `precision_manufacturing/models/hpu-manifold.glb` | `HMA-4000` hydraulic power unit manifold | 150 | precision |
| `automotive_precision/models/servo-motor-9000.glb` | `MTR-9000` servo motor | 150 | motor |

Each was baked once by running its STEP through a locally built `apps/assembler`
(`POST /v1/convert`, `linearDeflection: 0.5`, `angularDeflection: 0.3`). The generator
scripts and STEP files are not committed; see
`.ai/specs/2026-09-30-satellite-demo-cad-model.md` and
`.ai/specs/2026-09-30-demo-models-robotics-precision-motor.md`.

Re-baking changes every node id (a node id hashes the tessellation), so the step
`componentNodeIds` in `data/<key>/assembly.ts` must be regenerated from the new
`graph.json` in the same change.
