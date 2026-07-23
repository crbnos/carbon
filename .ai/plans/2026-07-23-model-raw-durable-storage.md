# Move retained model raws off ephemeral temp-staging → durable `private` (or prune)

## Context

`temp-staging` is **ephemeral** storage (transient TUS landing + assembler read
source). But the retained-raw pipeline currently keeps its **permanent** source
there: `model-compact` writes the compacted `.zst` **into temp-staging** and
repoints `modelUpload.modelPath` at it (`model-compact.ts:87,110,138`), and the
artifacts route serves the raw from there. So every model's raw source (needed for
re-optimise, lazy assembly-plan/convert, and mesh download) is on ephemeral
storage — it will be lost when temp-staging is cleared.

Prod exposure today: **13 referenced raws in temp-staging, ~1798 MB, 4 companies,
all `optimizeStatus = Success`** (so their optimised GLB already lives in durable
`private` — previews will survive; only the raw source is at risk). 12 are `.zst`
≤ 50 MB; 1 is `PEDAL 4 BOM.gltf` (1.85 GB, uncompacted).

Decision (user): **don't add a new bucket.** Optimise + compact the raw and try to
fit it in the durable `private` bucket (50 MB cap); if it doesn't fit, **prune the
raw** — the optimised GLB in `private` is already the preview.

Grounding facts:
- `private` bucket already has storage RLS for the `${companyId}/models/...` key
  layout (SELECT = employee role, INSERT/UPDATE/DELETE = `parts_*`) — see
  `20240630115404_model-uploads.sql`. **No new bucket or RLS migration needed.**
- private `file_size_limit` = 50 MB = `MODEL_RAW_KEEP_MAX_BYTES` (`@carbon/utils`)
  = the same cap the WASM viewer already uses to decide a raw is renderable.
- Jobs use `getCarbonServiceRole()` (bypass RLS). Viewer reads the raw via
  `getRawModelUrl(rawBucket, rawPath)` using whatever `rawBucket` the artifacts
  route returns, through the auth-checked `/file/preview` proxy.

## Design — the new retained-raw lifecycle

`temp-staging` becomes **purely transient** (TUS landing + assembler read source).
The retained raw lands in **durable `private`** when small enough, else is pruned.

**`model-compact` (assembler on):** compact as today (writes `.zst` to a staging
path), then in the `persist` step branch on the compacted size:
- **≤ 50 MB** → copy the `.zst` to `private` at
  `${companyId}/models/${modelUploadId}.${ext}.zst`, repoint `modelPath` there,
  delete the temp-staging original(s). Durable. `rawBucket` resolves to `private`.
- **> 50 MB** → **prune**: delete the temp-staging raw, keep the GLB. Leave
  `modelPath` as-is in the DB (do NOT null it — the ERP viewer derives the
  modelUploadId from `modelPath` client-side; nulling it would break GLB
  resolution). The object is simply gone; the artifacts route reports the raw as
  absent (below). Safe only because `optimizeStatus = Success` (GLB exists).

**Assembler-off / no-GLB case:** compaction needs the assembler, and with no GLB
the raw is the *only* copy — pruning would lose the model. So when the assembler
is unavailable: if the raw is ≤ 50 MB, **copy it to `private`** as-is (no assembler
needed, WASM renders it); if > 50 MB, leave it (pre-existing limitation — it can't
render via WASM anyway and there's no GLB; out of scope to fix here, just don't
make it worse). Wire this into the model-optimize/compact skip path.

**Artifacts route (`model.artifacts.$modelUploadId.ts`, ERP + MES mirror):**
resolve the raw location by probing **`private` first, then `temp-staging`**
(reverse of today), and if the object exists in neither, return `rawPath: null`
(pruned/gone) so the viewer shows no raw tier and relies on the GLB. Return the
resolved `rawBucket` accordingly.

**Prune (`cleanup.ts` `prune-staged-raw-models`):** once retained raws live in
`private`, temp-staging holds only in-flight + strays. Keep the orphan guard, but
the size gate can be dropped over time. Leave logic as-is for now (still correct);
revisit after the migration drains temp-staging.

## Changes

1. **`packages/jobs/src/inngest/functions/tasks/model-compact.ts`** — in `persist`,
   after reading `compactedSize`: if `≤ MODEL_RAW_KEEP_MAX_BYTES` copy the `.zst`
   temp-staging→`private`, repoint `modelPath` to the private path, delete the
   temp-staging original; else delete the temp-staging raw and leave `modelPath`
   (pruned). Import `MODEL_RAW_KEEP_MAX_BYTES` from `@carbon/utils`.
2. **Assembler-off raw persistence** — in `model-optimize.ts` (and/or
   `model-compact.ts`) skip path when `!assemblerEnabled()`: if the raw ≤ 50 MB,
   copy temp-staging→`private` and repoint `modelPath`; else leave.
3. **`apps/erp/app/routes/api+/model.artifacts.$modelUploadId.ts`** + MES mirror —
   probe `private` first, then `temp-staging`; `rawPath: null` when absent.
4. **Storage move helper** — cross-bucket copy. Verify Supabase JS supports
   `.copy(from, to, { destinationBucket })` in this version; if not, download +
   re-upload (objects are ≤ 50 MB, cheap). Put it in the assembler task helpers or
   a small shared util.

## Data migration — the 13 existing rows: NONE (decided)

Decision (user): **let the existing 13 be pruned without moving.** All 13 have
`optimizeStatus = Success`, so their optimised GLB already lives in durable
`private` (the preview survives). Their raw source is expendable, so no backfill is
built — `temp-staging`'s ephemeral lifecycle clears them, and the code already
degrades gracefully: the artifacts route probes `private`/staging → `rawPath: null`
once gone → the viewer renders the GLB. (A SQL migration couldn't move the bytes
anyway — Supabase keys the physical object by bucket; only the storage API
`move`/`copy` relocates the file, so a `bucket_id` UPDATE would orphan the bytes.)

Trade-off accepted: those 13 lose re-optimise / assembly-plan source + (for the one
mesh `.gltf`) the download. Previews are unaffected. New uploads are unaffected —
they relocate to durable storage within one job cycle via the changes above.

## Open decision (confirm before build)

- **modelPath on prune**: plan keeps `modelPath` non-null (dangling) so ERP's
  `CadModel` can still derive the modelUploadId; the artifacts route returns
  `rawPath: null` by existence-probe. Alternative (cleaner, more files): pass an
  explicit `modelUploadId` to every ERP `<CadModel>` call site (like MES already
  does) and null `modelPath` on prune. Recommend the dangling-modelPath approach
  (fewer files, no schema change); flag if you'd rather decouple properly.

## Verification

- `pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp --filter=mes`
- Local: upload a small STEP → optimise+compact → confirm the `.zst` lands in
  **private** (not temp-staging), `modelPath` points to private, temp-staging
  original gone, viewer renders (GLB), raw download works.
- Local: force a > 50 MB compacted result (or stub the size check) → confirm the
  raw is pruned, `modelPath` retained, viewer still renders the GLB, artifacts
  `rawPath: null`.
- Prod: run the one-off migration; re-run the temp-staging census query → expect 0
  referenced raws remaining (except any skipped no-GLB > 50 MB, logged).

## Critical files
- `packages/jobs/src/inngest/functions/tasks/model-compact.ts` — compact + persist
- `packages/jobs/src/inngest/functions/tasks/model-optimize.ts` — assembler-off skip
- `packages/jobs/src/inngest/functions/tasks/assembler-client.ts` — move helper
- `apps/erp/app/routes/api+/model.artifacts.$modelUploadId.ts` (+ MES mirror) — bucket probe
- New one-off Inngest fn for the 13-row migration (+ register in `inngest/index.ts`)
- `packages/jobs/src/inngest/functions/scheduled/cleanup.ts` — prune (unchanged for now)
