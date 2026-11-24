# Files, CAD and the viewer lessons

Uploads, storage, media and HEIC, CAD and STEP, the 3D viewer, Rust crates, PDFs and printing.

## A functions/shared source with npm deps must register them twice

```scope
id: a-functions-shared-source-with-npm-deps-must-register-them-t
paths: ["packages/files/src/media/image-pipeline.ts","packages/database/supabase/functions/deno.json"]
triggers: ["libheif-js","@jsquash/"]
```

**Context:** `functions/shared/image-pipeline.ts` follows the `precision.ts` pattern (source under `supabase/functions/`, re-exported by a Node package) but, unlike precision, imports npm packages (`libheif-js`, `@jsquash/*`).

**Problem:** Module resolution follows the FILE's location, not the importer's. Deno resolves the bare specifiers via `functions/deno.json` `imports`; Node/Vite resolve them from `packages/database/node_modules` — not from the re-exporting package. Registering the dep in only one place typechecks in one world and crashes in the other, and the versions can silently drift.

**Rule:** Obsolete: the pipeline moved to `@carbon/files` (`packages/files/src/media/image-pipeline.ts`, its deps in that package.json) and `functions/deno.json` no longer pins any deps. Still true: type declarations a module needs sit next to it (triple-slash reference) — ambient `.d.ts` files only load for programs that include them.

**Applies to:** `packages/files/src/media/image-pipeline.ts`.

## A wrapper that narrows a result type needs its call sites re-read, not re-cast

```scope
id: a-wrapper-that-narrows-a-result-type-needs-its-call-sites-re
paths: ["packages/files/src/storage.ts"]
triggers: ["CompanyBucket","as FileObject[]"]
```

**Context:** Replacing the free-function storage helpers
(`listCompanyPrivateObjects` and friends) with a fluent
`storage(client).company(id)` client in `@carbon/files`. The old helpers
returned `{ data: StorageFileLike[]; errors: [] }` — `data` never null, entries
structurally typed — so ~10 call sites carried `as FileObject[]` /
`as unknown as StorageItem[]` casts to recover the real supabase fields. The
new client returns supabase's own `{ data: FileObject[] | null; error }`.

**Problem:** Every one of those casts still compiled, and now silently asserted
away a `null` the wrapper had just introduced. `(result.data as FileObject[]).map(...)`
typechecks and throws at runtime the first time a company bucket errors —
exactly the case the legacy-fallback window makes likely. A cast written to
paper over a WIDER type keeps compiling when the type gets NARROWER, and TS
reports nothing.

**Rule:** When a refactor changes a shared helper's return type, grep its call
sites for casts on the changed field BEFORE trusting a green typecheck — a cast
is a silenced diagnostic, so the compiler cannot tell you it is now wrong.
Delete the cast and let the type flow; if the new type is right, the cast was
load-bearing only for the old one.

**Applies to:** `packages/files/src/storage.ts` (`CompanyBucket`), its ~60 call
sites across `apps/erp`, `apps/mes`, `packages/{jobs,ee,lib}`, and any future
change to a helper whose result is destructured widely.

## Assembly viewer camera + animation principles

```scope
id: assembly-viewer-camera-animation-principles
paths: ["packages/viewer/**","crates/planner/src/**"]
triggers: []
```

**Context:** Camera transitions and part-motion animation in the assembly instruction viewer (`packages/viewer`).

**Problem:** Per-step re-zooming and pure-geometry view heuristics lose the "where are we on the model" context; small fasteners are invisible at assembly scale; sparse path sampling produced false "removable" results (washer/bolt ordering bugs).

**Rule (user directives):**
- **Constant zoom, rotate-only:** per-step camera transitions keep the standing whole-assembly distance and only rotate toward the action — never re-zoom per step or frame a single small part tightly.
- **Occlusion-aware angles:** choose view direction by scoring how many parts block the line of sight to the animated part (seated pose + travel midpoint), not by pure geometry heuristics.
- **Exaggerate small parts:** bolts/washers get display-only exaggerated travel (>=2.5x their size) so insertions read at assembly scale.
- **Manual motion editing is a 0.001% escape hatch:** keep it collapsed behind "Edit manually"; motions come from the geometry planner.
- **Planner correctness beats coverage:** cap sample spacing (2mm) rather than sample count. Threaded fasteners need a thread-depth penetration allowance along their own axis because CAD models them as interfering solid cylinders.

**Applies to:** `packages/viewer/`, geometry planner (`crates/planner`).

## Browser code must import `@carbon/documents/utils`, never `@carbon/documents/pdf`

```scope
id: browser-code-must-import-carbon-documents-utils-never-carbon
paths: ["packages/documents/package.json","packages/documents/src/utils/index.ts","apps/erp/app/routes/share+/**"]
triggers: ["@carbon/documents/pdf","@carbon/documents/utils"]
```

**Context:** Adding a shared `getQuoteDisplayId` / `getPurchaseOrderDisplayId` helper for showing the revision suffix on documents. The natural home looked like the `./pdf` barrel, which already re-exported it for the server-side PDF routes.

**Problem:** `./pdf` is a barrel over every `@react-pdf/renderer` document component. A route `loader`/`action` can import from it safely — React Router strips server-only exports and tree-shakes the rest — but a **client-rendered component** cannot: the `/share/**` quote page and the ERP UI would pull the entire react-pdf graph into the browser bundle for a five-line string helper. The existing convention confirms this: ERP client components only ever import `@carbon/documents/template`, never `/pdf`.

**Rule:** Pure display helpers shared by server and browser belong in `packages/documents/src/utils/` and are exposed through the `./utils` export (type-only deps). Import them from `@carbon/documents/utils` in any component that renders in the browser. `src/utils/index.ts` is an explicit re-export list, not `export *` — the per-document util files each define their own `getLineDescription`, so a wildcard barrel collides.

**Applies to:** `packages/documents/package.json` exports, `packages/documents/src/utils/index.ts`, any `@carbon/documents` import inside `apps/erp/app/modules/**/ui/**` or `apps/erp/app/routes/share+/**`.

## Don't pre-sign a short-lived upload URL before a long-running operation

```scope
id: don-t-pre-sign-a-short-lived-upload-url-before-a-long-runnin
paths: ["packages/jobs/src/inngest/functions/tasks/assembly-plan.ts","apps/assembler/src/main.rs"]
triggers: ["createSignedUploadUrl"]
```

**Context:** `assembly-plan` pre-signed a `createSignedUploadUrl` for `plan.json`, then called the geometry `/plan` service which ran the motion planner (~3 min) and finally PUT the result to that URL. Uploads 400'd and the job stuck in `Processing` forever; the ERP UI polled "Solving motions…" indefinitely.

**Problem:** Supabase `createSignedUploadUrl` mints a **60-second** token and the SDK gives no way to extend it (it only honors `{ upsert }`; the TTL is a storage-server setting). By the time a multi-minute planner finished, the token had expired → `400 InvalidJWT "exp claim timestamp check failed"` → the service returned 502. The fast `/convert` path (~16s) never tripped it, so the pattern looked fine. Re-runs/"already exists" are a red herring — an upsert PUT to an existing object returns 200.

**Rule:** A pre-signed **upload** URL must be consumed within ~60s of minting. For any operation that can outlast that, don't hand the worker a pre-signed PUT URL — have the service **return the artifact inline** and let the worker persist it with the service-role client the moment it has the bytes (no token, no expiry). Also bound the outbound `fetch` with `AbortSignal.timeout(...)` so a hung service fails cleanly (→ `onFailure` marks the row Failed) instead of pinning it in `Processing`.

**Applies to:** `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts`, `apps/assembler/src/main.rs` (`/plan`); any Inngest task that pre-signs storage upload URLs before a slow external call.

## meshopt vertex codec requires a stride that is a multiple of 4 — i16 VEC3 normals break it

```scope
id: meshopt-vertex-codec-requires-a-stride-that-is-a-multiple-of
paths: ["crates/optimize/src/lib.rs","crates/optimize/src/codec.rs","packages/viewer/src/useAssembly.ts"]
triggers: ["byteStride","EXT_meshopt_compression","MeshoptDecoder","ViewData"]
```

**Context:** `crates/optimize` quantizes normals to i16 (SHORT, normalized) to shrink the optimised GLB, encoding each attribute as its own `EXT_meshopt_compression` vertex buffer. An i16 VEC3 normal is 6 bytes, so the normal view was emitted with `byteStride: 6`. The GLB reparsed and round-tripped fine through the Rust `meshopt` decoder, and all crate tests passed.

**Problem:** `meshopt_encodeVertexBuffer`/`decodeVertexBuffer` require the vertex size be a **multiple of 4** (`assert(vertex_size % 4 == 0)`); the Rust binding doesn't assert in release, so it emitted a 6-byte-stride stream that only its own decoder round-trips. The spec-compliant JS `MeshoptDecoder` (three.js / `three-stdlib`) rejects it with `Malformed buffer data: -2`, so the viewer showed a black screen — and because the failure is inside the decoder, no obvious app-level error surfaced. Positions (stride 12) and indices were fine; only the 6-byte normal stream broke.

**Rule:** Any attribute encoded as a meshopt vertex buffer must have a stride divisible by 4. Pad i16 VEC3 normals to i16 VEC4 (8 bytes, 4th lane `0`) — the accessor stays VEC3 (reads x,y,z; the 8-byte stride skips the pad) and the constant pad lane compresses to ~nothing. Never trust "reparses + Rust-decoder round-trips" as proof a meshopt GLB is valid; validate against the spec JS decoder (`GLTFLoader.setMeshoptDecoder`). The regression test `quantized_normals_keep_meshopt_stride_multiple_of_four` asserts every `ATTRIBUTES` view stride is `% 4 == 0`.

**Applies to:** `crates/optimize/src/lib.rs` (`ViewData`, the meshopt assemble path); any new quantized attribute type added to the optimiser; the `@carbon/viewer` `useAssembly` loader that consumes these GLBs.

## Name-only fastener classification: "pin" and spec suffixes mark structure as hardware

```scope
id: name-only-fastener-classification-pin-and-spec-suffixes-mark
paths: ["crates/planner/src/fasteners.rs","crates/planner/src/pipeline.rs","crates/planner/src/pipeline2.rs","crates/planner/src/greedy.rs"]
triggers: ["fastener_name_re","classify_fasteners","removal_priority","reselect_base"]
```

**Context:** The SA BCU's enclosure is named "Electronics Box - 36 Pin" (a connector pin COUNT). The fastener name regex matched `\bpin\b`, classifying the box as hardware: removal priority fronted it (fasteners first → expensive failed sweeps → flagged early), base candidacy excluded it, and the assembly sequence anchored on a gasket. One word in a part name inverted the entire build order.

**Problem:** Fastener detection is name-only; real CAD names carry fastener-ish tokens in structural parts (pin counts, "M8 slot pattern" spec suffixes). A false positive is fail-open: it changes scheduling, exemptions, and base selection everywhere at once.

**Rule:** Never classify on ambiguous single tokens — "pin" is out (dowel pins still match via "dowel"). Back the name test with physical sanity in `_classify_fasteners`: a name-matched part spanning more than `max(100mm, 0.35 × assembly diagonal)` keeps its structural role. When ordering goes absurd on a new model, print the `fasteners` cohort first — one misclassified structural part explains a scrambled sequence.

**Applies to:** `crates/planner/src` (`FASTENER_NAME_RE`, `_classify_fasteners`, `removal_priority`, `_reselect_base`); future classification heuristics.

## Profile the planner before optimizing — the flood was pass-through, not self-collision

```scope
id: profile-the-planner-before-optimizing-the-flood-was-pass-thr
paths: ["crates/planner/src/**"]
triggers: ["path_blockers","contacts_at"]
```

**Context:** Motion planning took ~3 min (seat rail) / >30 min (harness). A micro-benchmark showed a 2,000× per-sample cost for a part colliding with its own seated copy (it stays registered in the manager), so the "obvious" fix was to unregister the moving part during its own sweeps. Implemented, byte-identical output — and **zero real-model speedup** (191→211s). cProfile told the truth: 86% of total time was `_contacts_at` under `_path_blockers`, dominated by **pass-through enumeration** — sweeping a part THROUGH its blockers enumerates the blocker's full triangle-contact set (53M contact objects on a 31-part model) at every sample for the whole travel, when all `_path_blockers` needs is each blocker's identity, discovered once.

**Problem:** Micro-benchmarks measure the mechanism you built them around, not the workload. Self-collision flooding is real but self-overlap ends early in most sweeps; deep pass-throughs persist for hundreds of samples and were the actual cost. The two look identical from the outside (both are "too many contacts").

**Rule:** For planner performance work, cProfile the real model FIRST (`cProfile.run('plan_step(...)')` — 30s of setup) and read cumtime by caller before choosing a lever. The winning fix: in `_path_blockers`, once a partner is recorded as a blocker, unregister it from the broadphase for the remainder of the sweep and re-register before returning (`registerObject`/`unregisterObject` on the SAME CollisionObject rebuilds nothing — the BVH lives on the geometry). Seat rail 191–211s → 20–26s (8×), harness >30min → 9.5min, byte-identical sequences. Keep the self-unregister too (it's what makes the synthetic test suite 8× faster), but don't mistake it for the fix.

**Applies to:** `crates/planner/src` sweep functions (`_path_blockers`, `_contacts_at`, `_unregistered`); any future "collect all X along a path" collision query.

## Sweeping storage call sites by one literal misses named-constant buckets

```scope
id: sweeping-storage-call-sites-by-one-literal-misses-named-cons
paths: []
triggers: ["\"private\"","temp-staging","company-templates","storage.from("]
```

**Context:** The company-private-bucket migration swept every `storage.from("private")` call in the repo to per-company buckets. The literal grep found ~160 call sites and missed six more: `RAW_DURABLE_BUCKET = "private"` (assembler-client), `STORAGE_BUCKET = "private"` (company-backup/export), `BUCKET = "private"` (onshape-attach), `DOCUMENTS_BUCKET = "private"` (download.$token), `archiveBucket: "private"` (audit.config), and the `["private", "temp-staging"]` probe arrays in both apps' model.artifacts/model.download routes.

**Problem:** Each miss was a real defect, not noise — new CAD raws kept landing in the legacy bucket, backups silently skipped assets uploaded to company buckets, restores wrote assets back into the legacy bucket, and token downloads / audit-archive reads would 404 on new files once the legacy fallback is removed.

**Rule:** When migrating a string-keyed resource (a bucket, a queue, a topic), grep for the VALUE in every syntactic position — `= "x"`, `: "x"`, `"x",`, `("x"`, and type unions — not just the one call pattern you are rewriting. Constants exist precisely to hide the literal from the call site.

**Applies to:** any repo-wide sweep keyed on a string literal; storage buckets (`private`, `temp-staging`, `company-templates`), PGMQ queue names, Inngest event names.

## unpdf ships a dead 1.5 MB engine chunk unless aliased away

```scope
id: unpdf-ships-a-dead-1-5-mb-engine-chunk-unless-aliased-away
paths: ["apps/*/vite.config.ts","apps/*/app/ssr-shims/unpdf-pdfjs-stub.mjs"]
triggers: ["unpdf/pdfjs","definePDFJSModule"]
```

**Context:** `@carbon/files/pdf` uses unpdf but points it at react-pdf's `pdfjs-dist` in the browser (`definePDFJSModule`) so each bundle has one PDF.js engine.

**Problem:** unpdf's fallback `import("unpdf/pdfjs")` is never reached but is statically visible, so Vite emits its bundled serverless engine as a ~1.5 MB lazy chunk in every client build.

**Rule:** Any browser app consuming `@carbon/files/pdf` aliases `unpdf/pdfjs` to `app/ssr-shims/unpdf-pdfjs-stub.mjs` in its Vite config (both apps do). Verify with the built output: exactly one chunk should contain `GlobalWorkerOptions` + `PDFWorker`.

**Applies to:** `apps/{erp,mes}/vite.config.ts`, any new React Router app that reads PDFs client-side.

## drei GizmoHelper resets camera.up after a viewcube click

```scope
id: drei-gizmohelper-resets-camera-up-after-a-viewcube-click
paths: ["packages/viewer/src/useBuildFrame.ts","packages/viewer/src/orientation.ts"]
triggers: ["GizmoHelper","camera.up"]
```

**Context:** The assembly player shows a step's build orientation by rolling the camera (`camera.up` = the bench's up in the model frame, `packages/viewer/src/orientation.ts`).

**Problem:** drei's `GizmoHelper` writes `camera.up` on every frame of a face-click tween and resets it to the value it saw at mount when the tween ends (`core/GizmoHelper.js`). After one viewcube click the build stood upright again, and every later turn started from the wrong up.

**Rule:** Do not patch drei. Anything that owns `camera.up` must re-assert it in its own frame loop whenever it drifts outside its own animation.

**Applies to:** `packages/viewer/src/useBuildFrame.ts` (its `useFrame`), any code that sets `camera.up` under `GizmoHelper` or `OrbitControls`.

## Large text `.gltf` with an embedded base64 buffer can't be serde-parsed bounded — stream it into a GLB

```scope
id: large-text-gltf-with-an-embedded-base64-buffer-can-t-be-serd
paths: ["crates/optimize/src/lib.rs","apps/assembler/src/actions/optimize.rs"]
triggers: ["gltf_to_glb","DecoderReader","serde_json::from_slice"]
```

**Context:** The assembler optimises uploaded models. Text `.gltf` (the Onshape export shape) carries its single geometry buffer as a base64 `data:` URI. `optimize_gltf` did `serde_json::from_slice(gltf_bytes)` then base64-decoded the URI. GLB (`optimize_glb`) was already bounded — its BIN chunk is a `&[u8]` slice into the mmap.

**Problem:** For a 1.73 GB `.gltf`, serde materialises the base64 as an owned ~1.73 GB `String`, then base64-decode allocates ~1.3 GB more — both live at once → ~3 GB peak. mmap doesn't help because serde copies the string out of the mapped bytes. The assembler failed with "source file exceeds the size limit" (a separate cap) and, once that was lifted, was on track to OOM on parse.

**Rule:** Don't serde-parse a glTF whose buffer is a giant base64 data URI. Repack `.gltf` → `.glb` first with a **streaming** base64 decode: walk the JSON with `struson` (`transfer_to` copies the small structural fields verbatim, dropping the buffer's `uri`), then `next_string_reader()` the base64 value through `base64::read::DecoderReader` straight into the GLB BIN chunk on disk. Then mmap the `.glb` and use the already-bounded `optimize_glb` path — geometry never heaps. Verify decoded length == the buffer's declared `byteLength` (fail loud, never emit a corrupt GLB). `crates/optimize::gltf_to_glb` + `apps/assembler` `load_source` (`Format::Gltf` → repacked temp `.glb` → `Src::MappedTemp`).

**Applies to:** `crates/optimize/src/lib.rs` (`gltf_to_glb`; `optimize_gltf` was removed), `apps/assembler/src/actions/optimize.rs` (`load_source`, `run_optimize` — every source is GLB now); any new large-text-JSON asset with an embedded base64 blob.

## Never fabricate a "best-effort" motion through geometry

```scope
id: never-fabricate-a-best-effort-motion-through-geometry
paths: ["crates/planner/src/**","packages/viewer/src/fallback.ts","packages/viewer/src/AssemblyPlayer.tsx"]
triggers: ["generateAssemblyStepsFromPlan","blockedBy"]
```

**Context:** The assembly motion planner (`crates/planner/src`) had a tier-4 "forced removal" that gave unsolvable parts a straight-line motion through whatever blocked them, so every part animated. On the seat-rail assembly 6/30 parts got 48–647mm fly-through motions early in the sequence — the whole animation read as wrecked.

**Problem:** A fabricated path is worse than no path: it renders as a collision, erodes trust in every other step, and hides the real geometric finding (interlocked unit, embedded solid, missing mate exemption) behind a fake answer.

**Rule:** When a solver can't prove a result, emit an explicit flagged state (`motion: "none"` + `blockedBy` + warning) and give the UI a degraded-but-honest rendering (fade-in at the seated pose). Never ship a fabricated approximation of a geometric/physical claim. Same for display fallbacks: an AABB "least-blocked direction" guess may only be used where it's labeled as a guess, never silently for planner output.

**Applies to:** `crates/planner/src`, `packages/viewer` (fallback.ts, AssemblyPlayer), `generateAssemblyStepsFromPlan`.

## OCCT keeps every document it opened by path, and refuses to open it again

```scope
id: occt-keeps-every-document-it-opened-by-path-and-refuses-to-o
paths: ["crates/occt-bridge/src/*.cc","apps/assembler/src/actions/optimize.rs"]
triggers: ["read_xbf","read_pmi","run_ingest","TDocStd_Application"]
```

**Context:** The optimize ingest gained a PMI pass (`read_pmi`, `crates/occt-bridge/src/pmi.cc`) that reads the same `.xbf` the optimiser had just tessellated with `read_xbf` (2026-10-26).

**Problem:** `TDocStd_Application::Open(path, doc)` registers the document with the application until `Close(doc)`. `read_xbf` never closes it, so the second open of the same path failed with `PCDM_RS_AlreadyRetrieved` ("could not open XBF document"). The hermetic converter test passed, because it opened the `.xbf` only once; only the assembler's ingest test, which runs both passes, showed it.

**Rule:** A second reader of an `.xbf` opens it from a stream (`Open(std::istream&, doc)`), which skips the path check, and calls `xcaf_app()->Close(doc)` when done. Test any new pass over the ingest's xbf through `run_ingest`, not only through the converter.

**Applies to:** `crates/occt-bridge/src/*.cc` (any function that opens a BinXCAF document), `apps/assembler/src/actions/optimize.rs` (`run_ingest`).

## pdfjs rejects Node Buffer by constructor check

```scope
id: pdfjs-rejects-node-buffer-by-constructor-check
paths: ["packages/files/src/pdf/pdf.ts","packages/files/src/media/image-pipeline.ts"]
triggers: ["unpdf","@jsquash","getDocumentProxy"]
```

**Context:** `@carbon/files/pdf` and the shared image pipeline feed bytes from `fs.readFile` / `storage.download().arrayBuffer()` into pdfjs (via unpdf) and jSquash codecs.

**Problem:** pdfjs throws `Please provide binary data as 'Uint8Array', rather than 'Buffer'` — it checks the constructor, and Node's `Buffer` fails despite being a `Uint8Array` subclass. The failure only appears in Node (tests, jobs), never in the browser or Deno.

**Rule:** Normalize at the boundary: wrap as a plain view over the same memory — `new Uint8Array(data.buffer, data.byteOffset, data.byteLength)` — before handing bytes to a wasm codec or pdfjs. `@carbon/files` does this in its `toBytes` helpers; new entry points must too.

**Applies to:** `packages/files/src/pdf/pdf.ts`, `packages/files/src/media/image-pipeline.ts`, any future wasm codec wrapper.

## Storage keys built from raw filenames break silently — always sanitize, and the portal share route regex is a hidden contract with every upload path shape

```scope
id: storage-keys-built-from-raw-filenames-break-silently-always
paths: ["apps/erp/app/routes/share+/customer.$id.$.tsx","apps/erp/app/utils/supabase.ts","apps/mes/app/components/JobOperation/components/Step.tsx"]
triggers: [".upload(","stripSpecialCharacters","parseJobFilePath"]
```

**Context:** MES file/inspection step uploads (`RecordModal` in `apps/mes/app/components/JobOperation/components/Step.tsx`) put the raw `file.name` into the Supabase storage key. macOS screenshot names contain U+202F (narrow no-break space before "AM/PM"), which is outside Supabase storage's allowed-key charset.

**Problem:** The upload fails with "Invalid key", but the modal had already rendered the file card (`setFile` before the await), so the operator saw the file "attached" with the Record button permanently disabled — no actionable error. Separately, the customer-portal file route (`share+/customer.$id.$.tsx`) validated paths with a regex hardcoded to the *old* flat layout `companyId/job/operationId/file`; when `032f8d0e` nested step uploads under `/stepId/nanoid/`, every portal file link started returning 403 and nobody noticed for months.

**Rule:** (1) Any storage key that embeds a user-controlled filename must pass it through `stripSpecialCharacters` (canonical copy in `@carbon/utils`, re-exported by `~/utils/string` in ERP) with a `|| "file"` fallback for names that sanitize to empty. (2) The share-route path validation (`parseJobFilePath` in `apps/erp/app/utils/supabase.ts`, unit-tested) is coupled to every writer of the `companyId/job/...` prefix — changing an upload path shape requires updating the parser and its test in the same PR. The route also serves a file only when a File step's `jobOperationStepRecord.value` is that exact path (`getJobOperationFileRecord`) and its extension is a photo or PDF (`customerPortalServesFile`, `sales.utils.ts`), so a writer that stores a different value than the uploaded key breaks portal downloads the same way (`apps/erp/test/database/customer-portal.test.ts`). (3) On upload failure, reset the picker UI so the user can retry; never leave a dead-end state.

**Applies to:** all `storage.from(...).upload(...)` call sites in `apps/mes` and `apps/erp`; `share+/customer.$id.$.tsx`; any new externally-shared file route.

## Synthetic box meshes fake huge penetration under sustained sliding contact

```scope
id: synthetic-box-meshes-fake-huge-penetration-under-sustained-s
paths: ["crates/planner/tests/**"]
triggers: ["trimesh"]
```

**Context:** Writing planner ordering tests (`test_part_with_blocked_insertion_is_not_demoted`) with raw `trimesh.creation.box` parts: a slider seated 0.05mm into a channel floor read as depth **29.8mm** against the rail at every sweep sample, so the planner declared it inseparable and rigid-merged it.

**Problem:** FCL reports per-triangle-pair local penetration. A box face is two giant triangles; two near-coplanar giant triangles overlapping 0.05mm in the normal direction report a depth spanning their tangential overlap. Real STEP models never hit this — tessellation at `linearDeflection` keeps triangles small, so local depths stay bounded by element scale. The artifact only appears in synthetic tests whose parts sustain face-on-face sliding contact; brief seated contact that separates immediately (stacked boxes lifting off) is fine.

**Rule:** In planner tests, any part that must SLIDE while touching another needs `mesh.subdivide_to_size(5.0)` on both meshes — and prefer seating the moving part against a face perpendicular to its travel (contact vanishes on the first sample) over a face parallel to it (contact persists the whole sweep). Also avoid geometry where a seated bite must scrape past an opening sill: that is a real interference, not an artifact.

**Applies to:** `crates/planner/tests` synthetic fixtures; debugging any "cannot separate / planned as one rigid unit" result on hand-built trimesh geometry.

## The three.js rotate gizmo grabs whatever sits under its center

```scope
id: the-three-js-rotate-gizmo-grabs-whatever-sits-under-its-cent
paths: ["packages/viewer/src/MotionPathEditor.tsx"]
triggers: ["TransformControls","PivotControls"]
```

**Context:** The assembly path editor shows drei `TransformControls` (`mode="rotate"`) on a selected waypoint, whose draggable sphere sits at the gizmo's center.

**Problem:** In rotate mode the gizmo adds an invisible free-rotation picker — a sphere of radius 0.7 × gizmo size (`XYZE` in three-stdlib `controls/TransformControls.js`) — centred on its object. Dragging the waypoint sphere started that free rotation as well as the drag, so one gesture moved the part and spun it at once (2026-10-08).

**Rule:** Never let a rotate gizmo and another drag handle share a position. Make it a mode: either the handles drag or the rings show, never both. The path editor's Move / Rotate tool is the precedent (`MotionPathEditor.tsx`, `tool`).

**Applies to:** any `TransformControls` / `PivotControls` placed on top of an existing pointer handle in `packages/viewer`.

## trimesh CollisionManager rebuilds BVHs on every single-object query

```scope
id: trimesh-collisionmanager-rebuilds-bvhs-on-every-single-objec
paths: ["crates/planner/src/**"]
triggers: ["_contacts_at","_self_exempt"]
```

**Context:** Re-planning the 31-part seat rail took ~2 hours; the old planner took ~59s. `manager.in_collision_single(mesh, transform)` builds a fresh FCL BVH for the queried mesh on EVERY call, and the greedy loop also removed/re-added parts per attempt (another BVH rebuild each).

**Rule:** For sampled sweeps, cache the FCL BVH per mesh (`mesh_to_BVH` once, `fcl.CollisionObject` per query) and collide against `manager._manager` directly; never remove/re-add a manager object to "exclude" it — filter its contacts by name with an infinite allowance instead. Bound sampling by the AABB separation distance (beyond it, disjointness is provable).

**Applies to:** `crates/planner/src` (`_contacts_at`, `_self_exempt`), any trimesh/fcl sampling loop.

## "What is drawn" and "what blocks the view" must be derived from one predicate

```scope
id: what-is-drawn-and-what-blocks-the-view-must-be-derived-from
paths: ["packages/viewer/src/visibility.ts","packages/viewer/src/AssemblyPlayer.tsx"]
triggers: ["visualForComponent","occluderWeight","futureMode"]
```

**Context:** Adding `installedMode` to the assembly viewer (`packages/viewer/src/visibility.ts`). Two pieces of code answered questions about the same timeline: `visualForComponent` decided how a component renders, while the camera's AABB view-direction scorer decided how much it counts as an obstacle. The scorer was written inline inside `AssemblyPlayer`, hundreds of lines away.

**Problem:** They disagreed on one input. `visualForComponent` treats a component that **no step installs** exactly like a future-step one ("never already there"), so under the MES default `futureMode: "hidden"` it rendered hidden. The inline scorer computed `isFuture = stepIndex !== undefined && stepIndex > activeStepIndex` — `undefined` failed that test, so the same component kept full occluder weight. The camera picked view angles that dodged geometry it was not drawing. Silent: no error, nothing visibly broken, just subtly worse framing that no test covered because the logic was un-extractable inline.

**Rule:** When one fact (here: a component's position relative to the active step) drives both what the user sees and what the system reasons about, derive both from a single exported predicate in the same module, and assert the invariant that links them — *anything invisible is never an obstacle* — over the full cross-product of modes, not over hand-picked cases. The cross-product test is what caught this; a case-by-case test would have encoded the bug. Extracting the inline logic is the fix, not adding a comment telling the next person to keep them in sync.

**Applies to:** `packages/viewer/src/visibility.ts` (`visualForComponent` / `occluderWeight`), `packages/viewer/src/AssemblyPlayer.tsx`; any pair of render-vs-reason helpers over the same state.

## A catalog default holding a variable changes what a stored word means

```scope
id: a-catalog-default-holding-a-variable-changes-what-a-stored-w
paths: ["packages/documents/src/template/texts/**"]
triggers: ["documentTemplate","documentEdit"]
```

- **Context:** document texts store only the words a user changed, keyed by catalog key.
- **Problem:** when a key's default goes from `Date:` to `Date: {order.date}`, a stored `Order date:` keeps the key and prints no value, because the block no longer adds it.
- **Rule:** before moving a value into a catalog default, confirm no stored row holds that key. If one can, migrate the stored words too. Nothing checks a default's variables except `texts.test.ts`, so keep it passing.
- **Applies to:** `packages/documents/src/template/texts/`, `documentTemplate`, `documentEdit`.

## Browser-testing the 3D assembly page: one session, restart often

```scope
id: browser-testing-the-3d-assembly-page-one-session-restart-oft
paths: [".ai/playbooks/assembly-sub-assembly-motion-path.md","apps/erp/app/routes/x+/assembly+/**"]
triggers: ["agent-browser","AGENT_BROWSER_SESSION"]
```

**Context:** Driving `/x/assembly/:id` with `agent-browser` for screenshots and drags (2026-10-08).

**Problem:** After roughly 40 screenshots of the WebGL page the renderer reached 3 GB+, snapshots hung for over a minute, and a later revalidation failed with "Failed to fetch" plus "WebGL Context Lost". On a fresh dev server the login's Continue button also stays disabled until hydration finishes, which looks like a broken bot check.

**Rule:** Set `AGENT_BROWSER_SESSION` to the worktree's own name, `agent-browser close` and reopen after ~40 shots, and reload the login page once if Continue stays disabled. Drive the canvas with `mouse move/down/up`, not `click`. Radix menus ignore synthetic clicks there — move the mouse off the menu and use the arrow keys plus Enter.

**Applies to:** browser verification of `packages/viewer` features in the ERP editor; `.ai/playbooks/assembly-sub-assembly-motion-path.md`.

## GLB node↔nodeId joins must be validated against graph.json bboxes

```scope
id: glb-node-nodeid-joins-must-be-validated-against-graph-json-b
paths: []
triggers: ["graph.json","model.glb","trimesh"]
```

**Context:** Building BCU acceptance fixtures from the viewer GLB: nodeIds live in glTF node `extras` which trimesh drops, so the join went through world-transform matching. The geometry service bakes vertices in world space with identity node transforms — every node "matched" position (0,0,0) and the assignment silently scrambled 431 parts. The resulting degree/volume table looked plausible ("Seal Electronics Box, degree 19, 742cm³") and drove two wrong fix iterations before the graph.json bboxes exposed it.

**Problem:** A shuffled mesh↔name assignment still produces plausible-looking planner output — garbage in, plausible garbage out. Name-prefix or transform heuristics have no error signal of their own.

**Rule:** When joining GLB scene nodes to graph.json nodeIds, match on world BBOX against graph.json's per-leaf bbox (authoritative, written by the same converter) and assert coverage (all nodes matched, max error < 1mm) before trusting any downstream analysis. `/tmp`-fixture recipe: parse the GLB JSON chunk for extras + walk scenes for world matrices, then bbox-match to trimesh geometry.

**Applies to:** acceptance/repro scripts over viewer GLBs; any offline analysis pairing `graph.json` with `model.glb`.

## Ordering heuristics must be gated on a large noisy model, not just the seat rail

```scope
id: ordering-heuristics-must-be-gated-on-a-large-noisy-model-not
paths: ["crates/planner/src/**"]
triggers: ["removal_priority","_sandwiched_parts"]
```

**Context:** The weakly-secured-last + sandwich-gasket refactor validated green on 47 unit tests and a byte-identical 31-part seat-rail baseline, then made real planning slower with worse results. A 20-line classification probe on the 118-part SA Mando & Battery Harness immediately showed why: 4 sandwich detections — ALL false positives, including a 33mm "thin" part (ratio-only thinness cap) and two 10.4mm isotropic pass-through allowances (uncapped observed depth granted as "compliant squish").

**Problem:** The seat rail is a best-case model: named fasteners, clean contacts, no ambiguous plate stacks. Proxy signals calibrated there (name-only fastener detection, contact counts, thinness ratios) explode on models with unnamed hardware, clearance fits, and interpenetrating CAD. Two failure classes: (1) a *preference* wired into the greedy removal priority is not a preference — that ranking schedules expensive removal attempts and picks flag/merge victims, so fronting hard-to-remove parts multiplies failed sweeps (slower); (2) any heuristic that grants collision allowances fails open — one false positive corrupts collision truth for every sweep it touches (worse).

**Rule:** Before shipping a planner ordering/allowance heuristic: (a) run the classification-only probe (`.ai/scratch/geometry-probe.py`) on a large noisy model (harness/BCU class) and eyeball every cohort member and every allowance value — a 10mm "squish" is a bug, not a gasket; (b) keep display preferences in the topo sort only, never in `removal_priority`; (c) cap and axis-gate anything that relaxes collision tolerance, and prefer fail-closed (reject classification) over fail-open (grant allowance) when evidence is out of range.

**Applies to:** `crates/planner/src` ordering preferences, `_sandwiched_parts`-style classifiers, any future exempt/allowance mechanism.

## Penetration tolerances must stay far below sample spacing

```scope
id: penetration-tolerances-must-stay-far-below-sample-spacing
paths: ["crates/planner/src/**"]
triggers: ["PENETRATION_TOLERANCE_MM","MAX_SAMPLE_SPACING_MM"]
```

**Context:** The planner allowed 1.5mm "thread depth" penetration along a fastener's axis versus ALL parts, with collision samples every 2.0mm, to make solid-thread models removable through their nuts.

**Problem:** Tolerance ≈ spacing means a thin blocker (1mm washer, flange, cover) can pass between samples entirely below the allowance — the part "removes" through solid metal, which scrambles the greedy disassembly order downstream. A blanket allowance also applies to parts that have nothing to do with the threads.

**Rule:** Scope allowances to the specific mating pair that justifies them (fastener ↔ its detected threaded mate, capped at the seated interference + margin), keep the global tolerance an order of magnitude below sample spacing, and locally refine sampling near any contact that approaches the tolerance.

**Applies to:** `crates/planner/src` collision sampling; any sampled sweep/clearance check.

## react-pdf: `wrap={false}` loses text when the node is taller than the page

```scope
id: react-pdf-wrap-false-loses-text-when-the-node-is-taller-than
paths: ["packages/documents/src/pdf/**"]
triggers: ["wrap={false}","minPresenceAhead"]
```

**Context:** A list item in a PDF note rendered its bullet on one page and its text on the
next (TCK-57). The obvious fix was `wrap={false}` on the item row.

**Problem:** react-pdf 3.x keeps a paragraph of three lines or fewer whole, because
`widows` and `orphans` default to 2. The paragraph moved to the next page and left its
one-line bullet behind. `wrap={false}` fixes that, but react-pdf cannot split an unbreakable
node that is taller than the page. It draws the node past the page bottom and the text is
lost. Height does not follow text length: many line breaks or short paragraphs make a tall
node from little text.

**Rule:** Put `wrap={false}` only on a node you can prove fits on a page. Decide it in a pure
function and count each line break or block as a full line, as `keepListItemTogether` in
`Note.tsx` does. Prove a page-break change by rendering at many offsets and reading each
page's text back (pdfjs). A single render can land away from the boundary.

**Applies to:** `packages/documents/src/pdf/**`, any `wrap={false}` or `minPresenceAhead`.

## Verify what actually rendered before root-causing a "bad motion" report

```scope
id: verify-what-actually-rendered-before-root-causing-a-bad-moti
paths: ["packages/viewer/src/AssemblyPlayer.tsx","packages/viewer/src/fallback.ts","packages/viewer/src/validate-motion.ts","crates/planner/src/**"]
triggers: ["displayMotionForStep","synthesizeFallbackMotion","assemblyPlanJob"]
```

**Context:** A user reported step 4's screw+washer "colliding through the 3D MARKETING and seat rail clamp" and asked for a motion-planning refactor. A trimesh/FCL sweep of the STORED motion against the real GLB meshes showed it was collision-free against the entire model — and the only geometrically feasible insertion (the reverse sense jams the washer into the clamp bore by 3.4mm). The visible garbage came from elsewhere: a re-motion job was still running, so steps played stale/"none" motions through the collision-blind AABB display fallback, on top of 26 never-installed components being rendered solid.

**Problem:** A "the animation collides" report conflates at least four layers: the stored plan motion, the display-time fallback synthesis (`displayMotionForStep` → `synthesizeFallbackMotion`), display adjustments (`exaggerateMotion`), and the visibility model (what else is on canvas). Root-causing the planner first is attacking the strongest layer — the geometry service's motion had `verified: true` and meant it.

**Rule:** Before touching planner code for a visual-collision report: (1) check `assemblyPlanJob.status` — Queued/Processing means the user watched placeholder motions; (2) dump the step's stored `motion` from `assemblyInstructionStep` and sweep it against the GLB (the `collision` crate, or a small trimesh script; storage files live in the storage container under `/var/lib/storage/stub/stub/<bucket>/...`); (3) only if the stored motion itself collides is it a planner problem — otherwise it's fallback/visibility/display-layer work in `packages/viewer`.

**Applies to:** assembly-instruction motion bug reports; `packages/viewer/src/{motion,fallback,AssemblyPlayer}`; `crates/planner/src`.
