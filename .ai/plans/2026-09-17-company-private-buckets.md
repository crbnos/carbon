# Company Private Buckets — implementation plan

**Spec / source:** `.ai/specs/2026-09-17-company-private-buckets.md`
**Branch:** `feat/supabase-bucket-migration` (worktree `carbon-feat-supabase-bucket-migration`)

## Progress
- [x] Task 1: Storage contract in `@carbon/utils` (`storage.ts` + tests) — 14 tests pass
- [x] Task 2: Bucket-provisioning migration (trigger + backfill) — file written; `pnpm db:migrate` BLOCKED locally (worktree has no provisioned stack; `storage.buckets` missing in postgres-only stack) — apply from the main checkout
- [x] Task 3: Preview routes, `getPrivateUrl`, path helpers (ERP + MES) — gate amended to allow shared `public`/`temp-staging` buckets (behavior preservation; spec AC#4 adjusted)
- [x] Task 4: ERP module services + MCP signed-upload wrappers — 34 sites across 10 files
- [x] Task 5: ERP UI components sweep — 75 sites across 48 files
- [x] Task 6: ERP routes sweep (x+, api+, file+, share+) — 20 files incl. share-route TODO resolved
- [x] Task 7: MES app sweep — mes typecheck green
- [x] Task 8: packages/jobs + ee + lib sweep — added `@carbon/utils` dep to `@carbon/lib`; jobs/ee/lib typecheck green
- [x] Task 9: Edge function `import-csv` — inline fallback; deno not installed locally, CI checks
- [x] Task 10: Copy script `scripts/migrate-private-buckets.ts` — standalone tsc green, `--dry-run` supported
- [x] Task 11: Final verification sweep — all six typechecks green, 245 utils tests pass (14 new), lint 35/35, leftover sweep clean (only helper internals + import-csv inline fallback + copy-script source remain; scripts/model-upload.ts also migrated). `.claude/rules` mentions of the private bucket deliberately NOT updated yet — they document committed code only; sync post-commit.

## Dependencies
Task 1 first (everything imports it). Task 2 independent. Tasks 3–9 depend on 1 and are mutually independent (parallel subagents OK, but 4/5/6 touch adjacent ERP files — run 4 before 5/6 to avoid conflicts in service files imported by components). Task 10 independent of 3–9. Task 11 last.

## Shared conventions for every sweep task (3–9)

- Import from `@carbon/utils`: `getCompanyPrivateBucket`, `LEGACY_PRIVATE_BUCKET`, `downloadCompanyPrivateObject`, `createCompanyPrivateSignedUrl`, `listCompanyPrivateObjects`, `removeCompanyPrivateObjects`.
- **Writes** (`upload`, `createSignedUploadUrl`, `copy`, `move`): `client.storage.from(getCompanyPrivateBucket(companyId))` — no fallback. Object paths unchanged.
- **Reads** (`download`, `createSignedUrl`): use the fallback helpers, passing `client.storage`.
- **Lists**: `listCompanyPrivateObjects` (unions company + legacy, de-dup by name, company wins).
- **Removes**: `removeCompanyPrivateObjects` (both buckets, ignore missing).
- Where no `companyId` is in scope but the object path starts with it, derive: `const companyId = objectPath.split("/")[0]` with a comment. Prefer real companyId when available.
- Never touch: `temp-staging`, `company-templates`, `public`, `avatars`, `feedback` buckets; `getDatasetAssetUrl` branches; zstd logic in preview routes.
- If a call site doesn't fit these patterns, STOP and report — do not improvise.

---

## Task 1: Storage contract in `@carbon/utils`

**Depends on:** none
**Files:**
- Create: `packages/utils/src/storage.ts`
- Create: `packages/utils/src/storage.test.ts`
- Modify: `packages/utils/src/index.ts` — add `export * from "./storage";`

**Steps:**
1. Implement in `storage.ts` (no supabase-js dependency — structural typing):
   ```ts
   export const LEGACY_PRIVATE_BUCKET = "private";
   export const COMPANY_BUCKET_FILE_SIZE_LIMIT = 52428800;

   export const normalizeStorageSegment = (value: string) =>
     value.trim().replace(/[\\/]+/g, "-").replace(/^[-/]+|[-/]+$/g, "");

   export const getCompanyPrivateBucket = (companyId: string) =>
     normalizeStorageSegment(companyId);

   export const hasCompanyPrivateObjectPathPrefix = (companyId: string, objectPath: string) =>
     objectPath.startsWith(`${getCompanyPrivateBucket(companyId)}/`);

   export const buildCompanyPrivateStorageTarget = ({ companyId, logicalFolder, entityId, fileName }: {...})
     // => { physicalBucket, logicalFolder, objectPath: [bucket, folder, entityId?, fileName].filter(Boolean).join("/") }
   ```
   Fallback helpers take a minimal `StorageClientLike` interface (`from(bucket) => { download, createSignedUrl, list, remove }` with supabase-shaped `{ data, error }` returns):
   - `downloadCompanyPrivateObject({ storage, companyId, objectPath })` — try company bucket; on error/null data, try `LEGACY_PRIVATE_BUCKET`; return `{ data, physicalBucket, errors: { bucket, error }[] }`.
   - `createCompanyPrivateSignedUrl({ storage, companyId, objectPath, expiresIn })` — same two-step; returns `{ signedUrl, physicalBucket, errors }`.
   - `listCompanyPrivateObjects({ storage, companyId, prefix, options? })` — list both buckets (company first), union de-duped by `name`, company entries win; collect per-bucket errors; returns `{ data, errors }`.
   - `removeCompanyPrivateObjects({ storage, companyId, objectPaths })` — remove from company bucket AND legacy bucket; a "not found"/empty result on either is NOT an error; return combined `{ errors }` only for real failures.
2. Tests in `storage.test.ts` (vitest, mirror `packages/utils/src/*.test.ts` style): normalization edge cases; target path shape with/without `entityId`; download fallback order (company hit → no legacy call; company miss → legacy tried); list de-dup preference; remove tolerates missing on one bucket.

**Verify:**
```bash
pnpm --filter @carbon/utils test && pnpm --filter @carbon/utils typecheck
# Expected: storage.test.ts passes, tsgo exits 0
```

**Out of scope:** `packages/utils/src/storage-rules.ts` (warehouse rules, unrelated).

## Task 2: Bucket-provisioning migration

**Depends on:** none
**Files:**
- Create: via `pnpm db:migrate:new company-bucket-provisioning` (timestamp HHMMSS must not be 000000)

**Steps:**
1. Migration SQL:
   ```sql
   -- Backfill buckets for companies created after 20250827181005, 50MB cap
   INSERT INTO storage.buckets (id, name, public, file_size_limit)
   SELECT id, id, false, 52428800 FROM company
   ON CONFLICT (id) DO NOTHING;

   -- Normalize limit on the 2025 backfill rows (created with NULL)
   UPDATE storage.buckets SET file_size_limit = 52428800
   WHERE id IN (SELECT id FROM company) AND file_size_limit IS NULL;

   CREATE OR REPLACE FUNCTION public.create_company_private_bucket()
   RETURNS TRIGGER AS $$
   BEGIN
     INSERT INTO storage.buckets (id, name, public, file_size_limit)
     VALUES (NEW.id, NEW.id, false, 52428800)
     ON CONFLICT (id) DO NOTHING;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage;

   CREATE TRIGGER create_company_private_bucket_trigger
   AFTER INSERT ON "company"
   FOR EACH ROW EXECUTE FUNCTION public.create_company_private_bucket();
   ```
   (Precedent for AFTER INSERT ON company: `20240908100622_terms.sql:25`. SECURITY DEFINER needed — authenticated role can't write storage.buckets.)
2. `pnpm db:migrate` (applies + regenerates types; storage schema isn't in generated public types, so no TS diff expected).

**Verify:**
```bash
pnpm db:migrate
# Expected: migration applies cleanly; then `pnpm db:check:datasets` passes (company inserts still work)
```

**Out of scope:** RLS changes (20250827181005 already covers company buckets); dropping the "Shared Private Bucket" policy.

## Task 3: Preview routes, `getPrivateUrl`, path helpers

**Depends on:** 1
**Files:**
- Modify: `apps/erp/app/routes/file+/preview+/$bucket.$.tsx` — bucket gate + fallback download
- Modify: `apps/mes/app/routes/file+/preview+/$bucket.$.tsx` — same
- Modify: `apps/erp/app/utils/path.ts` — `getPrivateUrl` (line ~2388)
- Modify: `apps/mes/app/utils/path.ts` — `getPrivateUrl` (line ~227)

**Steps:**
1. Preview routes: keep zstd streaming and the existing segment-bounded ownership check EXACTLY as-is. Add after `requirePermissions`: allow only `params.bucket === getCompanyPrivateBucket(companyId) || params.bucket === LEGACY_PRIVATE_BUCKET`, else 403. Replace the direct `.download(...)` with `downloadCompanyPrivateObject` when the requested bucket is company/legacy (single code path — the helper tries both).
2. `getPrivateUrl(path, companyId?)` in both apps: keep the `getDatasetAssetUrl(path)` branch first. When a `companyId` argument is provided emit `/file/preview/${getCompanyPrivateBucket(companyId)}/${path}`; the no-arg legacy form derives the bucket from `path.split("/")[0]` (paths start with companyId) and falls back to `private` only if the first segment is empty. Update call sites of `getPrivateUrl` ONLY where the compiler forces it (signature stays backward compatible).

**Verify:**
```bash
pnpm --filter erp typecheck && pnpm --filter mes typecheck
# Expected: exit 0
```

**Out of scope:** `file+/model+/public.$.tsx` (Task 6); dataset-asset resolution.

## Task 4: ERP module services + MCP signed-upload wrappers

**Depends on:** 1 (do before 5/6)
**Files (Modify, apply shared conventions):**
- `apps/erp/app/modules/documents/documents.service.ts`
- `apps/erp/app/modules/inventory/inventory.service.ts`
- `apps/erp/app/modules/items/items.service.ts`
- `apps/erp/app/modules/production/production.service.ts`
- `apps/erp/app/modules/purchasing/purchasing.service.ts`
- `apps/erp/app/modules/quality/quality.service.ts`
- `apps/erp/app/modules/sales/sales.service.ts`
- `apps/erp/app/modules/sales/sales.import.server.ts`
- `apps/erp/app/modules/shared/shared.server.ts`
- `apps/erp/app/modules/shared/shared.service.ts`
- `apps/erp/app/modules/documents/documents.models.ts` — `buildDocumentUploadPath` gains no path change (path keeps companyId prefix) but its consumers' `createSignedUploadUrl` calls move to the company bucket

**Steps:**
1. Sweep every `from("private")` per shared conventions. Services already receive `companyId` in almost every signature; where one genuinely lacks it, derive from path first segment.
2. `shared.server.ts` (~L191,265,342,474 generated-PDF upload/copy + signed URLs): uploads/copies to company bucket; signed URLs via `createCompanyPrivateSignedUrl`.
3. MCP signed-upload wrappers (added in e0f8265ea4) in documents/items/production/purchasing/sales services: mint on company bucket.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exit 0
```

**Out of scope:** UI components (Task 5), routes (Task 6).

## Task 5: ERP UI components sweep

**Depends on:** 1, 4
**Files (Modify, apply shared conventions — all have `useUser()`/`company.id` available; precedent for the pattern: PR #682's `CadModel`/`Documents.tsx` changes, i.e. `const bucket = getCompanyPrivateBucket(company.id)` once per component):**
- `apps/erp/app/components/`: `AttachmentsList.tsx`, `DefaultAttachmentsPanel.tsx`, `Documents.tsx`, `Form/PdfExtractor.tsx`, `ImportCSVModal/UploadCSV.tsx`, `ItemThumnailUpload.tsx`, `Layout/Topbar/Suggestion.tsx`, `SlidesEditor.tsx`
- `apps/erp/app/modules/**/ui/`: `account/.../UserAttributesForm.tsx`, `accounting/.../FixedAssetNotes.tsx`, `documents/.../DocumentCreateForm.tsx`, `documents/.../useDocument.ts`, `inventory/.../PickingListNotes.tsx`, `inventory/.../ReceiptLines.tsx`, `inventory/.../ShipmentNotes.tsx`, `inventory/.../StockTransferNotes.tsx`, `items/.../ChangeNoticeActions.tsx`, `items/.../ChangeNoticeContent.tsx`, `items/.../BillOfProcess.tsx`, `items/.../ItemDocuments.tsx`, `items/.../ItemNotes.tsx`, `production/.../AssemblyInstructionProperties.tsx`, `production/.../AssemblyStepSlides.tsx`, `production/.../InspectionDocumentEditor.tsx`, `production/.../JobBillOfProcess.tsx`, `production/.../JobDocuments.tsx`, `production/.../JobNotes.tsx`, `production/.../ProcedureExplorer.tsx`, `purchasing/.../SupplierTaxForm.tsx`, `purchasing/.../SupplierInteractionDocuments.tsx`, `purchasing/.../SupplierInteractionLineDocuments.tsx`, `purchasing/.../SupplierInteractionLineNotes.tsx`, `purchasing/.../SupplierInteractionNotes.tsx`, `quality/.../GaugeCalibrationRecordForm.tsx`, `quality/.../QualityDocumentEditor.tsx`, `quality/.../IssueContent.tsx`, `quality/.../IssueTask.tsx`, `quality/.../IssueWorkflowForm.tsx`, `quality/.../RiskRegisterForm.tsx`, `resources/.../MaintenanceDispatchForm.tsx`, `resources/.../MaintenanceDispatchNotes.tsx`, `sales/.../CustomerTaxForm.tsx`, `sales/.../OpportunityDocuments.tsx`, `sales/.../OpportunityLineDocuments.tsx`, `sales/.../OpportunityLineNotes.tsx`, `sales/.../OpportunityNotes.tsx`, `sales/.../QuoteBillOfProcess.tsx`

**Steps:** apply shared conventions (uploads → company bucket; downloads/signed URLs → fallback helpers; lists → union helper; removes → both-bucket helper).

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exit 0
```

**Out of scope:** styling/behavior changes; `getPrivateUrl` internals (done in Task 3).

## Task 6: ERP routes sweep

**Depends on:** 1, 4
**Files (Modify, apply shared conventions):**
- `apps/erp/app/routes/api+/sales.digital-quote.$id.tsx`
- `apps/erp/app/routes/file+/model+/public.$.tsx`
- `apps/erp/app/routes/share+/customer.$id.$.tsx` — resolve the `// TODO` at ~L82: bucket = `getCompanyPrivateBucket(customerPortal.companyId)`; require `hasCompanyPrivateObjectPathPrefix(customerPortal.companyId, decodedPath)` else 404; download via fallback helper
- `apps/erp/app/routes/x+/`: `inspection-document+/$id.delete.tsx`, `maintenance+/$dispatchId.tsx`, `procedure+/$id.tsx`, `purchase-invoice+/new.tsx`, `purchase-order+/$orderId.finalize.tsx`, `purchase-order+/$orderId.tsx`, `purchasing-rfq+/$rfqId.finalize.tsx`, `quote+/$quoteId.drag.tsx`, `quote+/$quoteId.finalize.tsx`, `sales-invoice+/$invoiceId.post.tsx`, `sales-rfq+/$rfqId.drag.tsx`, `sales-rfq+/new.tsx`, `settings+/purchasing.tsx`, `shipment+/$shipmentId.post.tsx`, `supplier+/$supplierId.default-attachments.tsx`, `supplier-quote+/$id.send.tsx`, `training+/$id.tsx`

**Steps:**
1. Sweep per shared conventions. Finalize/send routes (`purchasing-rfq`, `purchase-order`, `quote`, `supplier-quote`, `sales-invoice`): email-attachment signed URLs via `createCompanyPrivateSignedUrl`; log the returned `errors` array before failing.
2. `file+/model+/public.$.tsx` downloads a model by path with no session — derive companyId from the path's first segment for the fallback helper.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exit 0
```

**Out of scope:** `send-email.ts` internals (stays SMTP-only, attachments arrive as URLs — no change needed there unless the compiler disagrees; if it does, STOP and report).

## Task 7: MES app sweep

**Depends on:** 1
**Files (Modify, apply shared conventions):**
- `apps/mes/app/services/operations.service.ts` (4 lists)
- `apps/mes/app/components/Suggestion.tsx`, `.../JobOperation/components/Step.tsx`, `.../JobOperation/components/MaintenanceDispatch.tsx` (uploads)

**Verify:**
```bash
pnpm --filter mes typecheck
# Expected: exit 0
```

## Task 8: packages/jobs + ee + lib sweep

**Depends on:** 1
**Files (Modify, apply shared conventions; all run server-side with serviceRole clients):**
- `packages/jobs/src/inngest/functions/`: `extraction/extract-document.ts` (download), `scheduled/cleanup.ts` (list/info), `tasks/assembly-convert.ts` (signed upload URLs), `tasks/assembly-plan.ts`, `tasks/model-optimize.ts` (list + signed upload URL), `tasks/model-thumbnail.ts` (upload/remove), `tasks/print-job/renderers.tsx` (download)
- `packages/ee/src/paperless-parts/lib/lib.ts` (3 uploads)
- `packages/lib/src/slack.server.ts:118` (createSignedUrl → fallback helper)

**Steps:** event payloads already carry `companyId` in most of these; where only a path exists, derive from first segment with a comment.

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck && pnpm --filter @carbon/ee typecheck && pnpm --filter @carbon/lib typecheck
# Expected: exit 0 for all three
```

## Task 9: Edge function `import-csv`

**Depends on:** none (can't import `@carbon/utils` — Deno)
**Files:**
- Modify: `packages/database/supabase/functions/import-csv/index.ts` (~L971)

**Steps:** inline two-step download: try `client.storage.from(companyId).download(filePath)` (companyId is in the validated payload), on error fall back to `from("private")`. No shared-lib extraction for one call site.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check import-csv/index.ts
# Expected: exit 0 (if deno isn't installed locally, STOP and note it in the run log; CI checks it)
```

## Task 10: Copy script

**Depends on:** none
**Files:**
- Create: `scripts/migrate-private-buckets.ts`
- Copy from (precedent): `scripts/model-upload.ts` (env/client setup style), PR #682's `scripts/migrate-private-buckets.ts` (shape)

**Steps:**
1. For each `company.id` (service-role client): `createBucket(companyId, { public: false, fileSizeLimit: 52428800 })` tolerating "already exists"; recursively list `private` under `companyId/` (paginate, recurse folders); `copy(key, key, { destinationBucket: companyId })`; count 409/"already exists" as skipped. Print per-company `{ copied, skipped, failed }` and a final summary. Never delete.
2. Add a `--dry-run` flag that lists what would be copied.

**Verify:**
```bash
pnpm exec tsx scripts/migrate-private-buckets.ts --dry-run
# Expected: runs against local stack, prints per-company summary, exits 0
```

**Out of scope:** deleting legacy objects (follow-up per spec).

## Task 11: Final verification sweep

**Depends on:** all
**Steps:**
1. `rg 'from\("private"\)' apps packages scripts --type ts` — expected hits ONLY in: `packages/utils/src/storage.ts` (helper internals), `packages/database/supabase/functions/import-csv/index.ts` (inline fallback), `scripts/migrate-private-buckets.ts` (source bucket), contrib examples. Anything else = missed site, go fix.
2. `rg 'LEGACY_PRIVATE_BUCKET' packages/utils/src/storage.ts` — constant exists.
3. Typechecks: `pnpm exec turbo run typecheck --filter=@carbon/utils --filter=erp --filter=mes --filter=@carbon/jobs --filter=@carbon/ee --filter=@carbon/lib`.
4. Tests: `pnpm --filter @carbon/utils test`.
5. `pnpm run lint`.
6. Update `.claude/rules/` / AGENTS.md if any documented storage claim went stale (check `rg -l 'private.*bucket' .claude/rules packages/*/AGENTS.md -i` and fix only real staleness).

**Verify:** all commands above exit 0; report actual outputs.
