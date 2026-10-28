# PMI in the STEP viewer — implementation plan

**Spec:** .ai/specs/2026-10-26-step-pmi-viewer.md
**Research:** .ai/research/step-pmi-viewer.md
**Closest sibling:** the optimize thumbnail (a second ingest output of `model-optimize`)
**Branch:** tokyo

## Progress
- [x] Task 1: Add `read_pmi` and the AP242 fixture writer to `occt-bridge`
- [x] Task 2: Build `pmi.json` in `converter`, with tests
- [x] Task 3: Write the `pmi` output from the `optimize` action
- [x] Task 4: Add `modelUpload.pmiPath`
- [x] Task 5: Request, persist and back up `pmiPath` in `@carbon/jobs`
- [x] Task 6: Return `pmiPath` from the artifacts routes
- [x] Task 7: Add the `pmi.ts` contract and formatter to `@carbon/viewer`, with tests
- [x] Task 8: Draw the PMI layer and the PMI panel
- [x] Task 9: Pass `pmiUrl` from the ERP and MES hosts
- [x] Task 10: Verify end to end

## Deviations during the build

- `CODE_VERSION` stays at 4. Only `plan` reads the result-pointer cache, so a bump would only throw away cached results.
- The `pmi.json` path is unique per run, after the self-review found a race between two runs of one model.
- Task 4 ran against a throwaway database restored from a sibling worktree's schema (same 1,238 migrations), because the shared Redis pool was full and `crbn` could not start this worktree's stack.
- Task 2 step 15 changed: OCCT reads none of NIST STC 06's 12 views (it stops at the first camera with no draughting model). The test asserts STC 06's PMI only; CTC 01 (1 view) and CTC 05 (2 views) carry the view tests.
- Task 10 ran the browser check on a throwaway Vite page that mounts the real `ModelPreview`, for the same reason.

## Dependencies
- Task 2 needs Task 1. Task 3 needs Task 2.
- Task 5 needs Task 4. Task 6 needs Task 4.
- Task 8 needs Task 7. Task 9 needs Tasks 6 and 8.
- Tasks 1–3 (Rust) and Tasks 4–8 (TypeScript) are independent of each other.

## Build environment

The host has no Rust toolchain and no OCCT. Run every cargo command in the dev container:

```bash
docker run --rm -v "$PWD":/repo -v carbon-target:/target -v carbon-cargo:/usr/local/cargo/registry \
  -v "$PWD/.context/pmi-fixtures":/fixtures carbon-rust-dev <cargo command>
```

The image `carbon-rust-dev` is built from `.context/dev/Dockerfile` (OCCT `carbon-occt:8.0.0-p1`, FCL, Draco, Rust 1.99). NIST fixtures are in `.context/pmi-fixtures/` (not committed).

---

## Task 1: Add `read_pmi` and the AP242 fixture writer to `occt-bridge`

**Depends on:** none
**Files:**
- Modify: `crates/occt-bridge/src/lib.rs` — new shared structs and two functions in the cxx bridge
- Modify: `crates/occt-bridge/src/occt.h` — declarations
- Create: `crates/occt-bridge/src/pmi.cc` — the PMI walk
- Modify: `crates/occt-bridge/build.rs` — compile `pmi.cc`
- Copy from (precedent): `read_xbf`, `doc_to_tree`, `write_test_step` in `crates/occt-bridge/src/occt.cc`; `XDEDRAW_GDTs.cxx` in `.context/occt-src` for the getters

**Steps:**
1. Add these shared structs to the bridge: `PmiTree { ok, error, items: Vec<PmiRaw>, faces: Vec<PmiMesh>, edges: Vec<PmiPolyline>, views: Vec<PmiViewRaw> }`.
2. `PmiRaw` holds: `kind` (0 dimension, 1 tolerance, 2 datum, 3 note), `type_name`, `name`, the number fields, the string-list fields, `lines: Vec<PmiPolyline>`, `mesh: PmiMesh`, plane and text point (with `has_*` flags), `faces: Vec<u32>`, `edges: Vec<u32>`, `datum_refs: Vec<String>`, `datum_ref_modifiers: Vec<String>`.
3. `PmiViewRaw` holds `name`, `direction[3]`, `up[3]`, `projection` (0 none, 1 parallel, 2 central), `items: Vec<u32>`.
4. Declare `fn read_pmi(path: &str, angular_deflection: f64) -> PmiTree;` and `fn write_test_pmi_step(path: &str) -> bool;`.
5. In `read_pmi`, open the file as `.xbf` when it starts with `BINFILE`, else as STEP with the same reader setup as `read_step_to_doc`.
6. If `DimTolTool` has no dimension, tolerance or datum labels and `ViewTool` has no view labels, return `ok=true` with empty lists.
7. Walk the free shapes and their components once. Record the first world `TopLoc_Location` of every product label.
8. For each GD&T label, read the object once with `GetObject()`. Read the referenced shapes with `GetRefShapeLabel`.
9. Find the owner part: `refL.Father()` when `IsSubShape(refL)`, else `refL`. Use the owner's first world location; identity when unknown.
10. Discretize presentation edges with `BRepAdaptor_Curve` and `GCPnts_TangentialDeflection`. Read presentation faces with `BRep_Tool::Triangulation`.
11. Mesh each referenced face once with `BRepMesh_IncrementalMesh`, then read its triangulation. Store it once in `faces` and index it.
12. Discretize each referenced edge into `edges`, once per edge.
13. Transform every point, normal and direction by the owner location.
14. Map every OCCT enum to a stable lower camel case string in a `switch` (for example `Location_LinearDistance` → `linearDistance`).
15. Store the dimension's lower tolerance as a negative number.
16. For tolerances, read datum references with `GetDatumWithObjectOfTolerLabels`, in datum `GetPosition` order.
17. For views, read `XCAFView_Object` `ViewDirection`, `UpDirection` and `Type`, and map `GetRefGDTLabel` to item indices.
18. Wrap the walk in `try { } catch (Standard_Failure&) { }`. On a throw, return `ok=false` with the message.
19. In `write_test_pmi_step`, build a 100×50×20 mm box in a new XCAF document.
20. Add one linear distance dimension (two opposite faces, 100 mm, +0.1 / −0.05), with a presentation of two edges.
21. Add one flatness tolerance (value 0.05) on the top face, referencing datum A.
22. Add datum A on the bottom face.
23. Write the document with `STEPCAFControl_Writer` and `write.step.schema` 5 (AP242).

**Verify:**
```bash
docker run --rm -v "$PWD":/repo -v carbon-target:/target -v carbon-cargo:/usr/local/cargo/registry carbon-rust-dev cargo build -p occt-bridge --release
# Expected: "Finished `release` profile"
```

If the OCCT writer does not write the semantic GD&T, STOP and report — do not improvise.

**Out of scope:** `read_step`, `read_xbf`, `tessellate`, `Builder` — their output must not change.

## Task 2: Build `pmi.json` in `converter`, with tests

**Depends on:** Task 1
**Files:**
- Create: `crates/converter/src/pmi.rs`
- Modify: `crates/converter/src/lib.rs` — `pub mod pmi;`
- Create: `crates/converter/tests/pmi.rs`
- Copy from (precedent): `crates/converter/src/graph.rs` (serde emit), `crates/converter/tests/multibody_split.rs` (hermetic fixture test)

**Steps:**
1. Define the serde types of `pmi.json` version 1 in `pmi.rs`, exactly as the spec's `PmiDocument`. Use `#[serde(rename_all = "camelCase")]`.
2. Add `pub fn extract_pmi(path: &str, source_unit: Option<&str>) -> Result<Option<PmiDocument>, String>`.
3. Return `Ok(None)` when the tree has no items and no views.
4. Give ids in document order per kind: `d1…`, `t1…`, `a1…`, `n1…`.
5. Merge datums with the same name. Keep the first copy with lines or a mesh. Point every view at the kept id.
6. Round every coordinate to 4 decimals (0.1 µm).
7. Add `pub fn to_json(doc: &PmiDocument) -> Result<Vec<u8>, String>` with the 16 MB cap.
8. If the JSON is over the cap, empty `faces` and retry once. If it is still over, return an error.
9. In `tests/pmi.rs`, write the fixture with `write_test_pmi_step`. Assert 1 dimension, 1 tolerance and 1 datum.
10. Assert the dimension's values (100, 0.1, −0.05) and that it references 2 faces with triangles.
11. Assert that the tolerance lists datum `A`.
12. Write the fixture to `.xbf` with `step_to_xbf`. Assert that `extract_pmi` on the `.xbf` gives the same JSON.
13. Add `nist_fixtures` tests that skip unless `PMI_FIXTURES` is set.
14. For CTC 01: assert at least 20 items, each with lines or a mesh.
15. For STC 06: assert 12 views.
16. For CTC 01: assert that the PMI bounding box overlaps the bounding box of `convert_step_head(...).graph`'s root.

**Verify:**
```bash
docker run --rm -v "$PWD":/repo -v carbon-target:/target -v carbon-cargo:/usr/local/cargo/registry -v "$PWD/.context/pmi-fixtures":/fixtures -e PMI_FIXTURES=/fixtures carbon-rust-dev cargo test -p converter --release
# Expected: every test result "ok", including the pmi tests
```

If the NIST counts differ from the spec, update the spec's acceptance criteria with the real counts. Explain why in the run record.

**Out of scope:** `graph.rs`, `glb.rs`, `nodeid.rs`.

## Task 3: Write the `pmi` output from the `optimize` action

**Depends on:** Task 2
**Files:**
- Modify: `apps/assembler/src/actions/optimize.rs` — `PmiOut`, `run_ingest`, `spawn`
- Modify: `apps/assembler/src/request.rs` — parse `pmi: { path }` in `optimize_ingest`
- Modify: `apps/assembler/AGENTS.md` — document the `pmi` output
- Copy from (precedent): `ThumbnailOut` and the `thumbnail` output in `optimize.rs`

**Steps:**
1. Add `pub pmi: Option<Option<String>>` to `OptimizeReq` (outer `Some` = asked for, inner = path).
2. In `run_ingest`, after a successful optimize, call `converter::pmi::extract_pmi` on `ingest.load_path`.
3. Pass the source unit from `converter::graph::detect_source_unit_bytes` when the source is STEP.
4. If the call fails, push `pmi: <message>` into `outcome.warnings`. Never fail the job.
5. If a document exists, add output `pmi` (`application/json`) and `result.outputs.pmi = { path, bytes, items, views }`.

**Verify:**
```bash
docker run --rm -v "$PWD":/repo -v carbon-target:/target -v carbon-cargo:/usr/local/cargo/registry carbon-rust-dev cargo test -p assembler --release
# Expected: every test result "ok"
```

**Out of scope:** the `convert`, `plan`, `compact` and `thumbnail` actions.

## Task 4: Add `modelUpload.pmiPath`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_model-pmi-artifact.sql` (via `pnpm db:migrate:new model-pmi-artifact`)
- Modify (generated): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`
- Copy from (precedent): `packages/database/supabase/migrations/20260714120000_model-optimize-artifact.sql`

**Steps:**
1. Run `pnpm db:migrate:new model-pmi-artifact`.
2. Write the SQL: a comment and `ALTER TABLE "modelUpload" ADD COLUMN IF NOT EXISTS "pmiPath" TEXT;`.
3. Run `pnpm db:migrate`.
4. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -c '"pmiPath"' packages/database/src/types.ts
# Expected: 3 or more (Row, Insert, Update)
```

If the local database is down, add the column to `types.ts` by hand in Row, Insert and Update, in the same place as `optimizedModelPath`. Record that in the run record.

**Out of scope:** RLS (the table keeps its policies).

## Task 5: Request, persist and back up `pmiPath` in `@carbon/jobs`

**Depends on:** Task 4
**Files:**
- Modify: `packages/jobs/src/inngest/functions/tasks/model-optimize.ts`
- Modify: `packages/jobs/src/inngest/functions/tasks/model-rows.ts` — `pmiPath` in the row type and the select
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.ts` — `STORAGE_PATH_COLUMNS`
- Modify: `packages/jobs/src/inngest/functions/tasks/company-backup.closure.test.ts` — `MODEL_UPLOAD_PATH_COLUMNS`
- Copy from (precedent): the `thumbnail` path, mint and persist in `model-optimize.ts`

**Steps:**
1. Set `pmiPath = ${companyId}/models/${modelUploadId}/pmi-${run}.json` (unique per run, like the thumbnail).
2. Send `pmi: { path: pmiPath }` in the body.
3. Sign a `pmi` upload URL in the company bucket.
4. Add `pmi?: { bytes?: number }` to `IngestOutputs`.
5. In `persist`, set `pmiPath: outputs.pmi ? pmiPath : null`.
6. If the row held a different `pmiPath`, remove that object (best effort, log a warning on failure).
7. Add `"pmiPath"` to `STORAGE_PATH_COLUMNS` and to `MODEL_UPLOAD_PATH_COLUMNS`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs && pnpm --filter @carbon/jobs test -- company-backup.closure
# Expected: typecheck passes; the closure tests pass
```

**Out of scope:** `assembly-convert.ts`, `model-compact.ts`.

## Task 6: Return `pmiPath` from the artifacts routes

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/routes/api+/model.artifacts.$modelUploadId.ts`
- Modify: `apps/mes/app/routes/api+/model.artifacts.$modelUploadId.ts`
- Modify: `packages/viewer/src/useOptimizedModel.ts` — `pmiPath?: string | null` in `ModelArtifacts`

**Steps:**
1. Add `pmiPath` to the `select` in both routes.
2. Return `pmiPath: model.data?.pmiPath ?? null`.
3. Add the optional `pmiPath` field to `ModelArtifacts` with a doc comment.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: both pass
```

## Task 7: Add the `pmi.ts` contract and formatter to `@carbon/viewer`, with tests

**Depends on:** none
**Files:**
- Create: `packages/viewer/src/pmi.ts`
- Create: `packages/viewer/src/pmi.test.ts`
- Copy from (precedent): `packages/viewer/src/graph.ts` and `graph.test.ts`

**Steps:**
1. Export the TypeScript types of the spec's `PmiDocument`. They must match `crates/converter/src/pmi.rs` field for field.
2. Export `parsePmiDocument(json: unknown): PmiDocument | null`. It returns null for a wrong `version` or a wrong shape.
3. Export `formatPmiItem(item, unit: "mm" | "in", sourceUnit): { label: string; symbol: string | null; title: string }`.
4. Format dimensions: prefix (⌀, R, S⌀, SR), the nominal, then `±t`, `+u/−l`, limits `u/l`, or the fit class.
5. Format angles in degrees with `°`, never converted.
6. Format tolerances as a frame: the characteristic symbol, the zone (`⌀` for a diameter zone), Ⓜ/Ⓛ, then the datum letters.
7. Use the file's decimals only when the display unit is the source unit. Else use 3 decimals for mm and 4 for in, trimming zeros.
8. Export `groupPmiItems(doc)` (Dimensions, Tolerances, Datums, Notes) and `visibleItemIds(doc, viewId | null)`.
9. Write tests: parse a good and a bad document, and each format rule above, in mm and in.

**Verify:**
```bash
pnpm --filter @carbon/viewer test -- pmi
# Expected: all pmi tests pass
```

## Task 8: Draw the PMI layer and the PMI panel

**Depends on:** Task 7
**Files:**
- Create: `packages/viewer/src/PmiLayer.tsx`
- Modify: `packages/viewer/src/ModelCanvas.tsx` — `pmi`, `pmiState` props; render `PmiLayer` in `ModelScene`; camera focus
- Modify: `packages/viewer/src/ModelPreview.tsx` — `pmiUrl` prop, load, shared unit state, `PmiPanel`
- Copy from (precedent): `ModelMetricsPanel`, `UnitToggle` and `Row` in `ModelPreview.tsx`; `frameBox` in `ModelCanvas.tsx`

**Steps:**
1. In `PmiLayer`, merge each item's `lines` into one `LineSegments` per item.
2. Draw a mesh for each item's `mesh`.
3. Color unselected items with the theme foreground. Color the selected item blue (`0x3b82f6`), with `depthTest: false` and a high `renderOrder`.
4. Draw the selected item's faces as a blue transparent mesh with `polygonOffset`.
5. Draw the selected item's edges as blue lines.
6. For items with no lines and no mesh, draw a drei `Html` label at `textPosition`, else at the center of its faces. Cap the labels at 200.
7. In `ModelCanvas`, add a `focus` request. For an item, look along the plane normal and fit the item's and its faces' box.
8. For a view, use the view's `direction` and `up`, then fit the view's items' box.
9. Reuse `frameBox` with a given direction and up vector.
10. In `ModelPreview`, fetch `pmiUrl` once (`fetch` + `parsePmiDocument` in a `useEffect`).
11. Lift the unit state out of `ModelMetricsPanel`. Start it at the PMI `sourceUnit` when it is `mm` or `in`, else `imperial`.
12. Add `PmiPanel` under the Measurements panel. It holds the eye toggle, a view select (when views exist) and the grouped list.
13. Make a click on an item select it, and a second click clear it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/viewer && pnpm --filter @carbon/viewer test
# Expected: typecheck passes; all viewer tests pass
```

**Out of scope:** `AssemblyPlayer.tsx`, `RawModelCanvas`.

## Task 9: Pass `pmiUrl` from the ERP and MES hosts

**Depends on:** Tasks 6 and 8
**Files:**
- Modify: `apps/erp/app/components/CadModel.tsx`
- Modify: `apps/mes/app/components/JobOperation/JobOperation.tsx`
- Modify: `apps/mes/app/components/AssemblyView.tsx` — only where `ModelPreview` gets `optimizedUrl` from `artifacts`
- Copy from (precedent): the `optimizedUrl` prop in `CadModel.tsx` (with the `?v=` cache-buster)

**Steps:**
1. Pass `pmiUrl={artifacts?.pmiPath ? getPrivateUrl(artifacts.pmiPath) : null}`. The path is unique per run, so it needs no cache-buster.
2. Do the same in each MES host that reads `artifacts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes && pnpm exec biome check packages/viewer apps/erp/app/components/CadModel.tsx apps/mes/app/components
# Expected: both typechecks pass; Biome reports no errors
```

## Task 10: Verify end to end

**Depends on:** Tasks 1–9
**Steps:**
1. Run all Rust tests (Task 2 command, plus `cargo test -p assembler`).
2. Run `pnpm --filter @carbon/viewer test` and the scoped typechecks.
3. If a local stack with the assembler runs, upload `nist_ctc_01_asme1_ap242-e1.stp` to a part.
4. Open the PMI panel. Pick a position tolerance. Take a screenshot to `.context/`.
5. If no stack with the assembler runs, record "browser test skipped" and the reason in the run record.

**Verify:**
```bash
# Expected: every command above passes; the screenshot shows the PMI panel and a highlighted face
```
