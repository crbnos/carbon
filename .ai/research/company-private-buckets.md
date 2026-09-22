# Research: Company Private Buckets (migration off shared `private` bucket)

Worktree: `carbon-feat-supabase-bucket-migration` (branch feat/supabase-bucket-migration, at main = e0f8265ea4).
Reference: PR crbnos/carbon#682 (branch company-private-buckets, 89 files, +2377/-550).

## 1. Current state in this worktree

### 1.1 Migration 20250827181005_company-bucket-rls.sql — EXISTS
- `packages/database/supabase/migrations/20250827181005_company-bucket-rls.sql:1-6` — backfills one bucket per existing company: `INSERT INTO storage.buckets (id, name, public) SELECT id, id, false FROM company`.
- Drops ~70 legacy per-feature storage.objects policies (lines 9-79), then creates exactly two policies:
  - `"Shared Private Bucket"` (lines 82-91): `bucket_id = 'private' AND (storage.foldername(name))[1] = ANY(get_companies_with_employee_role())` — legacy bucket stays readable, companyId must be first folder.
  - `"Company bucket access"` (lines 95-102): `bucket_id = ANY(get_companies_with_employee_role())` — full access to your company's bucket.
- **No auto-creation for NEW companies.** `storage.buckets` inserts exist only in migrations (buckets, feedback-bucket, company-bucket-rls, onboarding-and-backups, temp-staging-bucket — verified by `rg 'storage\.buckets'`). The three `AFTER INSERT ON "company"` triggers (20240908100622_terms.sql:25, 20241127142822_sales-settings.sql:33, 20260109134902_search-refactor.sql:187) create terms/settings/search rows; none of those files mention buckets. No TS code calls `createBucket` (rg `createBucket` over apps/packages/scripts: zero hits). A company created after 2025-08-27 has RLS ready but **no bucket**.

### 1.2 Other buckets in later migrations
- `20260617100002_onboarding-and-backups.sql:61-62` — shared `company-templates` bucket (service-role-only backup templates; comment at lines 55-60 explicitly says a per-company bucket can't serve these).
- `20260715150742_temp-staging-bucket.sql:28-30` — `temp-staging` bucket (2.5 GB cap) for raw CAD; line 32 caps `private` at 50 MB; policies at lines 43-64 scope `temp-staging` by `${companyId}/models/...` key layout (line 37 comment).

### 1.3 Legacy `private` bucket usage inventory (`rg 'from\("private"\)' --type ts`; no single-quote variants exist)
Files / call-site occurrences:
- apps/erp: **76 files / 142 occurrences**
- apps/mes: **4 files / 7 occurrences**
- packages/jobs: **7 files / 12 occurrences**
- packages/ee: 1 file / 3 (paperless-parts/lib/lib.ts:843,932,2006 — uploads)
- packages/lib: 1 file / 1 (slack.server.ts:118 — createSignedUrl)
- packages/database edge functions: 1 file / 1 (functions/import-csv/index.ts:971 — download)
- contrib/building: 2, scripts/model-upload.ts: 1 (examples/tooling)

Operation mix in apps/erp (same-line + next-line method match): upload ~71, list ~20, remove ~18, download ~12, createSignedUrl ~10, copy 2, move 2.
apps/mes: list x4 (services/operations.service.ts), upload x3 (components/Suggestion.tsx, JobOperation/components/Step.tsx, JobOperation/components/MaintenanceDispatch.tsx).
packages/jobs: model-thumbnail.ts:96,129 (upload/remove), model-optimize.ts:192,209 (list/createSignedUploadUrl), assembly-plan.ts:236,260,294, assembly-convert.ts:176,179 (createSignedUploadUrl), print-job/renderers.tsx:205 (download), extraction/extract-document.ts:67 (download), scheduled/cleanup.ts:425 (list/info).
packages/documents has NO direct storage calls (rg: zero hits) — attachments are resolved by callers (finalize routes / jobs) before emailing.

### 1.4 Preview/download routes
- `apps/erp/app/routes/file+/preview+/$bucket.$.tsx` and `apps/mes/app/routes/file+/preview+/$bucket.$.tsx` are near-identical: `requirePermissions` → ownership check → service-role download from `params.bucket`.
- Ownership check is already hardened (erp $bucket.$.tsx:81-87): `decodedPath.startsWith(`${companyId}/`) || decodedPath.includes(`/${companyId}/`)` — segment-bounded, not `.includes(companyId)`. Same in MES.
- Both routes have newer zstd handling the PR base lacks (erp $bucket.$.tsx:64-77, 123-137 — `.zst` decompress streaming).
- Path helpers: `path.to.file.previewFile(path)` → `/file/preview/${path}` (erp path.ts:1035, mes path.ts:105); `path.to.file.preview(bucket, path)` (erp path.ts:1033-1034).
- `getPrivateUrl(path)` → `getDatasetAssetUrl(path) ?? \`/file/preview/private/${path}\`` in BOTH apps (erp app/utils/path.ts:2365-2369, mes app/utils/path.ts:227-231) — hardcodes bucket `private`; also has demo-template dataset-asset branch the PR base lacked.
- Share route `apps/erp/app/routes/share+/customer.$id.$.tsx:82`: `let bucket = "private"; // TODO: refactor to use companyId when we separate the storage buckets`.

### 1.5 Signed URL / email attachment flows
- Finalize/send routes mint 3600s signed URLs on `private` and pass them as email attachment `path`: e.g. purchasing-rfq $rfqId.finalize.tsx:244-245, 265-266; also shared.server.ts:191,265,342,474 (generated PDF upload/copy flows), purchase-order finalize, quote finalize, supplier-quote send, sales-invoice post (all in the 76-file list).
- `packages/jobs/src/inngest/functions/notifications/send-email.ts` was REWRITTEN on main (commit 9fe6981ea8 "Send app email over SMTP; drop Resend"): now imports `sendEmail` from `@carbon/lib/email.server` and just forwards `payload.attachments` (send-email.ts:1-4, 40-49). No Resend, no per-company integration lookup.

### 1.6 Edge functions
- Only `packages/database/supabase/functions/import-csv/index.ts:971` touches `private` (`client.storage.from("private").download(filePath)`).

### 1.7 @carbon/utils
- No file-storage helpers exist. `packages/utils/src/storage-rules.ts` is warehouse storage-rule evaluation, unrelated. None of the PR's helper names (`getCompanyPrivateBucket` etc.) exist anywhere in this worktree (rg: zero hits).

## 2. PR #682 design summary

89 changed files, +2377/-550. Feature commits eab8f4197→5a7c54d8c, then "clean break" refactor 8c0ad2d81 ("remove storage fallback and implement clean break"), migration-script rework 0b9f933a1, signed-URL fix 925a2040c, plus many main merges.

### 2.1 Shared contracts — new `packages/utils/src/storage.ts` (+ storage.test.ts)
- `normalizeStorageSegment(value)` — trim, collapse `\`/`/` runs to `-`, strip leading/trailing `-`/`/`.
- `getCompanyPrivateBucket(companyId)` = `normalizeStorageSegment(companyId)` — bucket id IS the companyId.
- `buildCompanyPrivateStorageTarget({companyId, logicalFolder, fileName, entityId?})` → `{physicalBucket, logicalFolder, objectPath}` where `objectPath = [physicalBucket, logicalFolder, entityId?, fileName].join("/")` — **companyId stays the FIRST path segment inside the company bucket** (paths unchanged vs legacy, only the bucket differs; that's what makes copy-with-same-key migration work).
- `hasCompanyPrivateObjectPathPrefix(companyId, objectPath)` — `objectPath.startsWith(`${bucket}/`)`.
- `downloadCompanyPrivateObject` / `listCompanyPrivateObjects` / `createCompanyPrivateSignedUrl` — dependency-injected callbacks (`downloadObject(physicalBucket, objectPath)` etc.), returning `{data, errors: PrivateBucketAttemptError[], physicalBucket}`.

### 2.2 Legacy fallback: REMOVED in final state
- Final `downloadCompanyPrivateObject` tries ONLY the company bucket — one attempt, errors collected, no retry on `private` (`requestedBucket` param is accepted but unused). The PR description still advertises fallback, but commit 8c0ad2d81 switched to a clean break; correctness then depends entirely on running the copy script first.

### 2.3 Preview/share route hardening
- ERP/MES `$bucket.$.tsx`: adds `if (bucket !== getCompanyPrivateBucket(companyId)) return 403` AND `hasCompanyPrivateObjectPathPrefix(companyId, decodedPath)` (replacing the old loose `decodedPath.includes(companyId)` of ITS base — this worktree already has a stronger segment check).
- `share+/customer.$id.$.tsx`: removes the `bucket = "private"` TODO; parses `[pathCompanyId, logicalFolder, operationId, fileName]` from the path, requires `pathCompanyId === customerPortal.companyId` + prefix check, downloads via `downloadCompanyPrivateObject` with `getCompanyPrivateBucket(customerPortal.companyId)`.
- `path.to.file.previewFile` gains an overloaded `(bucket, path)` form; `getPrivateUrl` becomes overloaded — `(bucket, objectPath)` preferred, single-arg legacy form derives the bucket from the path's first segment (`getRequestedPrivateBucketFromPath`), marked `@deprecated`.

### 2.4 Signed-URL fix (925a2040c)
- Touches purchasing-rfq finalize, supplier-quote send, send-email.ts, storage.test.ts, mcp tool-metadata.json. Replaces bare `serviceRole.storage.from("private").createSignedUrl(path, 3600)` with `createCompanyPrivateSignedUrl({...})`, logging each `PrivateBucketAttemptError` and passing `signedUrlResult.signedUrl` to attachments; send-email normalizes attachments to `{filename, path}` (URL) vs `{filename, content, encoding: "base64"}` and adds a per-company Resend/SMTP provider switch (now moot — see 2.7).

### 2.5 Migration script `scripts/migrate-private-buckets.ts` (new, 106 lines)
- For each `company.id`: `supabase.storage.createBucket(companyId, {public:false, fileSizeLimit: 52428800})` tolerating "already exists"; then recursively `list` legacy `private` under prefix `companyId` and `copy(itemPath, itemPath, {destinationBucket: companyId})` — same key, new bucket. Idempotent: 409/"already exists" copy errors counted as skipped. Copy-only (two-pass design per commit 0b9f933a1) — legacy objects are NOT deleted.

### 2.6 SQL / bucket creation in the PR
- The PR contains **zero SQL migration changes** (grep 'supabase/migrations' over the diff: 0). RLS relies on 20250827181005 already being on main.
- Bucket creation exists ONLY in the migration script (diff line: `supabase.storage.createBucket(companyId, ...)`); **no code path creates a bucket when a new company is created** — same gap as this worktree.

### 2.7 Merge-conflict risk vs this worktree's main — HIGH
- `e0f8265ea4` (2026-09-16, MCP file-upload tools): adds new `from("private")` sites the PR never saw — `createSignedUploadUrl` wrappers in documents/items/production/purchasing/sales service files + `buildDocumentUploadPath` (documents.models.ts:54, path shape `${companyId}/${folder}/${entityId}/${sanitizedName}` in `private`). PR touches 4 of those same service files.
- `9fe6981ea8` rewrote send-email.ts to SMTP-only via `@carbon/lib/email.server` — PR's send-email rewrite (Resend/SMTP provider switch, company integration lookup) conflicts wholesale and is partly obsolete.
- Preview routes: worktree added zstd streaming + the segment-bounded ownsPath check; PR rewrites the same lines from an older base.
- `getPrivateUrl` in both apps now has the dataset-asset branch (erp path.ts:2365) the PR's rewrite drops.
- temp-staging bucket (20260715150742) and its `private` 50 MB cap post-date the PR's design.
- PR also carries unrelated scope from its long life: setup.sh/dev-CLI commit f1c3ac240, swagger-schema pruning, "delete rolloute AI Agent" (729932af9).

## 3. Open design questions

- Bucket provisioning for NEW companies: DB trigger on `company` insert (SQL can insert into storage.buckets, as 20250827181005 proves) vs app-level `createBucket` in the company-create flow vs lazy-create-on-first-write? Nothing exists today in either the worktree or the PR.
- Clean break vs read fallback: PR ended with no legacy fallback, so cutover requires the copy script to complete first; do we want a fallback window (read company bucket then `private`) to deploy code before/without downtime?
- Keep companyId as the first object-path segment inside the company bucket (PR choice, enables same-key copy + reuses `${companyId}/...` RLS/path checks) — or strip it now that the bucket itself scopes tenancy (would break same-key migration and every `buildDocumentUploadPath`-style helper)?
- Legacy `private` bucket end-of-life: script copies but never deletes; who deletes, when, and does the `"Shared Private Bucket"` RLS policy get dropped?
- temp-staging + `company-templates` interplay: temp-staging RLS keys on `${companyId}/models/...` inside a shared bucket — migrate CAD staging to company buckets too (2.5 GB cap is per-bucket!) or leave it shared? Per-company buckets inherit which file_size_limit (script hardcodes 50 MB)?
- New MCP `createSignedUploadUrl` flows (e0f8265ea4) mint upload URLs on `private` via authenticated client relying on the `"Shared Private Bucket"` RLS — porting them to company buckets needs the `"Company bucket access"` policy to cover signed-upload mints and the wrappers rewritten.
- Non-app consumers: packages/jobs (7 files), edge function import-csv, packages/ee paperless-parts, packages/lib slack — several receive only a path, not a companyId; is companyId always recoverable (first path segment) or must event payloads change?
- `getCompanyPrivateBucket` = raw companyId: any risk of collision with reserved bucket ids (`private`, `public`, `avatars`, `models`, `temp-staging`, `company-templates`, `feedback`) or Supabase bucket-name constraints for existing companyIds?
- Backups/exports (20260617100002 onboarding-and-backups): do company backup/restore flows enumerate buckets, and does per-company bucketing change restore targets?
