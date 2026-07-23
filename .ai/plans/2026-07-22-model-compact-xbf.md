# Model raw retention: decoupled compact + xbf mode + orphan-only prune

Problem: STEP raws >50MB get lost. Compact (raw → `.zst`) only runs inside the
optimize success path (best-effort), and the nightly prune deletes any
non-`.zst` `temp-staging` raw >50MB older than 7 days — including raws whose
optimize failed/was skipped, legacy pre-pipeline raws, and compact-failed raws.
Result: `modelUpload.modelPath` points at a deleted object → assemblies say
"no model".

Decisions (user-approved 2026-07-22):
- Compact STEP raws to **xbf** (`STEP → OCCT BinXCAF → zstd`, mode `xbf`) —
  far smaller than zstd'd ASCII STEP. Mesh raws keep mode `zstd`.
- xbf raws are **not downloadable** (OCCT-internal format) — hide the download
  action in the files lists.
- Compact is decoupled from optimize success; prune becomes orphan-only.

## Tasks

- [x] 1. `packages/lib/src/events.ts` — add `carbon/model-compact` event
      `{ modelUploadId, companyId }`.
- [x] 2. `packages/utils/src/file.ts` — add `isModelRawDownloadable(modelPath)`:
      false when the `.zst`-peeled path ends `.xbf`. Export via utils barrel.
- [x] 3. New `packages/jobs/src/inngest/functions/tasks/model-compact.ts` —
      standalone Inngest function (retries 3): load row; skip if already
      `.zst`, non-`temp-staging` bucket, no optimizable format, or assembler
      disabled; mode `xbf` for `step` (output `{id}.xbf.zst`) else `zstd`
      (output `{id}.{format}.zst`); persist repoint (freeze `originalSize`,
      rewrite `size`), delete fat original.
- [x] 4. `model-optimize.ts` — remove inline compact block; fire
      `carbon/model-compact` on success, on alreadyOptimized (heals legacy
      fat raws), and in `onFailure`.
- [x] 5. Register function in `tasks/index.ts` + `inngest/index.ts`.
- [x] 6. `cleanup.ts` prune — exclude any candidate still referenced by a
      `modelUpload.modelPath` (orphan-only delete).
- [x] 7. `production.models.ts` `getAssemblyModelState` — accept `.xbf`.
- [x] 8. Hide download for non-downloadable raws in `Documents.tsx`,
      `OpportunityLineDocuments.tsx`, `JobDocuments.tsx`, `ItemDocuments.tsx`.
- [x] 9. Update stale comments (`const.ts` prune note, model-optimize header).

## Verification

- `pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/jobs --filter=erp`
- Existing behavior preserved: already-compacted `.step.zst` rows still read
  (assembler content-sniffs; state check peels `.zst`).
