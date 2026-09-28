# Company-Specific Private Storage Buckets

**Status:** Draft — awaiting approval
**Date:** 2026-09-17
**Research:** [.ai/research/company-private-buckets.md](../research/company-private-buckets.md)
**Prior art:** PR crbnos/carbon#682 (reference implementation; NOT merged — this is a clean re-implementation on current main)

## Problem

All private files (documents, CAD models, generated PDFs, MES attachments) live in one shared `private` bucket, with tenancy enforced only by a `companyId/` path-prefix RLS check. One sloppy policy leaks every tenant's files; per-company export/deletion means filtering a giant shared bucket; per-bucket controls (size limits) can't differ per tenant.

Per-company buckets already exist in the schema — `20250827181005_company-bucket-rls.sql` backfilled one bucket per company (bucket id = companyId) with RLS (`"Company bucket access"`) — but **no application code uses them**, and **companies created after that migration get no bucket at all**.

## Goals

1. Every private-file read/write in ERP, MES, `@carbon/jobs`, `@carbon/ee`, `@carbon/lib`, and edge functions targets the company bucket (`storage.from(companyId)`), not `storage.from("private")`.
2. Legacy files still in `private` keep working during a fallback window (reads/lists/signed URLs fall back).
3. New companies automatically get a bucket (DB trigger).
4. A one-off, idempotent copy script migrates legacy objects into company buckets.
5. Preview/share routes are hardened: requested bucket must equal the caller's company bucket.

## Non-Goals

- Deleting legacy objects or dropping the `"Shared Private Bucket"` RLS policy — **follow-up ~1 week after prod verification** (user decision).
- Removing the fallback code — same follow-up.
- `temp-staging` (CAD staging) and `company-templates` (backups) buckets — separate designs, untouched.
- `public`, `avatars`, `feedback` buckets — untouched.
- Re-keying object paths (paths keep the `companyId/` first segment — see decisions).

## Design

### 1. Shared storage contract — new `packages/utils/src/storage.ts`

Adopt PR #682's contract (it's sound; re-implement, don't cherry-pick, since the PR conflicts heavily with current main):

- `normalizeStorageSegment(value)` — trim, collapse `\`/`/` runs to `-`, strip leading/trailing separators.
- `getCompanyPrivateBucket(companyId)` → normalized companyId. The bucket id IS the companyId.
- `buildCompanyPrivateStorageTarget({companyId, logicalFolder, entityId?, fileName})` → `{physicalBucket, objectPath}` where `objectPath = companyId/logicalFolder[/entityId]/fileName` — **identical to today's legacy paths**, only the bucket differs.
- `hasCompanyPrivateObjectPathPrefix(companyId, objectPath)`.
- Fallback-aware, dependency-injected read helpers (unlike PR #682's final clean-break versions, ours DO fall back):
  - `downloadCompanyPrivateObject` — try company bucket, then `private`; return `{data, physicalBucket, errors[]}`.
  - `createCompanyPrivateSignedUrl` — same two-step.
  - `listCompanyPrivateObjects` — list BOTH buckets, union de-duplicated by name, company bucket wins.
- `LEGACY_PRIVATE_BUCKET = "private"` named constant; fallback lives ONLY in these helpers so the follow-up removal is one file.

Unit tests in `packages/utils/src/storage.test.ts` (path shapes, normalization, fallback order, list de-dup).

### 2. Bucket provisioning for new companies — new migration

`pnpm db:migrate:new company-bucket-provisioning`:

- `AFTER INSERT ON "company"` trigger (same pattern as the existing terms/settings/search company-insert triggers) inserting `(id, id, false, 52428800)` into `storage.buckets` with `ON CONFLICT (id) DO NOTHING`.
- Backfill in the same migration for any company created since 2025-08-27 that lacks a bucket (`INSERT ... SELECT ... ON CONFLICT DO NOTHING`), with the same 50 MB `file_size_limit` (matching the cap `20260715150742` put on `private`); also `UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id IN (SELECT id FROM company)` to normalize the 2025 backfill rows that got NULL.
- No RLS changes — `"Company bucket access"` from `20250827181005` already covers company buckets (including signed-upload mints, which run as the authenticated user against `storage.objects` INSERT).

### 3. Call-site migration (the bulk)

Every `storage.from("private")` call site (76 files ERP, 4 MES, 7 jobs, 1 ee, 1 lib, 1 edge function — see research §1.3) changes as follows:

| Operation | New behavior |
|---|---|
| upload / `createSignedUploadUrl` / copy / move (writes) | company bucket only, via `getCompanyPrivateBucket(companyId)`; no fallback |
| download / `createSignedUrl` (reads) | via fallback helpers |
| list | via union helper |
| remove | attempt on BOTH buckets, ignore not-found (a file can be in either during the window) |

Where a consumer has only a path and no companyId in scope (some jobs/edge-function payloads), derive it from the path's first segment — valid because paths keep the `companyId/` prefix. Prefer passing companyId explicitly where the payload already carries it.

Specific flows called out:

- **Preview routes** (`apps/erp/app/routes/file+/preview+/$bucket.$.tsx`, MES twin): keep current zstd streaming + segment-bounded ownership check; add `bucket === getCompanyPrivateBucket(companyId) || bucket === "private"` gate (403 otherwise) and route downloads through the fallback helper. Legacy `/file/preview/private/...` URLs keep working.
- **`getPrivateUrl`** (both apps): keep the dataset-asset branch; emit `/file/preview/{companyBucket}/{path}` for new URLs.
- **Share route** `share+/customer.$id.$.tsx`: resolve the TODO — bucket from `customerPortal.companyId`, require path companyId match, download via fallback helper.
- **Generated documents / email attachments** (finalize/send routes, `shared.server.ts`, `send-email.ts`): signed URLs via `createCompanyPrivateSignedUrl`; keep the current SMTP-only `send-email.ts` (do NOT port PR #682's obsolete Resend/provider switch).
- **MCP file-upload tools** (`e0f8265ea4`: `buildDocumentUploadPath` + `createSignedUploadUrl` wrappers in documents/items/production/purchasing/sales services): mint upload URLs on the company bucket.
- **Edge function** `import-csv/index.ts:971`: download via fallback (inline two-step; edge runtime can't import `@carbon/utils` — mirror the helper in `functions/lib/` if cleaner).

### 4. Copy script — `scripts/migrate-private-buckets.ts`

Same shape as PR #682's final script: per company, `createBucket` (tolerate exists), recursively list `private` under the `companyId/` prefix, `copy(key, key, {destinationBucket: companyId})`, count 409s as skipped. Copy-only — never deletes. Idempotent, safe to re-run. Run against prod after deploy; legacy cleanup happens ~a week later as a separate task.

### 5. Rollout sequence

1. Merge + deploy (migration adds trigger/backfill; code writes new files to company buckets, reads fall back to `private`). Zero downtime, no ordering constraint.
2. Run the copy script.
3. ~1 week verification, then follow-up PR: remove fallback branches, delete legacy objects, drop `"Shared Private Bucket"` policy.

## Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | New-company bucket provisioning | DB `AFTER INSERT` trigger + backfill migration | **User-decided.** Covers all creation paths atomically; matches existing company-insert triggers |
| 2 | Legacy compatibility | Read-fallback + copy script; cleanup deferred | **User-decided.** Zero-downtime; PR #682's clean break requires script-before-deploy sequencing |
| 3 | Object path shape | Keep `companyId/` as first segment inside company bucket | **User-decided.** Stored DB paths stay valid; copy is same-key; consumers without companyId can derive it from the path |
| 4 | Legacy EOL | Out of scope; ~1 week post-verification follow-up | **User-decided** ("clean it up after a week or so when we have verified all works good") |
| 5 | List during fallback window | Union of both buckets, de-dup by name, company bucket wins | Documents UI must show legacy files until the copy script runs |
| 6 | Remove during fallback window | Delete from both buckets, ignore missing | A file exists in exactly one (or both post-copy); partial delete would resurrect files |
| 7 | Bucket `file_size_limit` | 52428800 (50 MB), same as `private` | Behavior-preserving; per-company overrides possible later |
| 8 | `temp-staging` / `company-templates` | Untouched | Separate designs (2.5 GB CAD staging; service-role backup templates that a comment in `20260617100002` explicitly says can't be per-company) |
| 9 | send-email | Keep current SMTP-only implementation | PR #682's Resend/provider switch predates `9fe6981ea8`; porting it would regress main |
| 10 | Fallback location | Only inside the `packages/utils/src/storage.ts` helpers | Follow-up removal is a one-file change, not another 90-file sweep |
| 11 | Bucket id collisions | None possible in practice; trigger uses `ON CONFLICT DO NOTHING` | companyIds are generated ids; reserved bucket names (`private`, `public`, `avatars`, `models`, `feedback`, `temp-staging`, `company-templates`) don't collide with id-space |

## Acceptance Criteria

1. Upload a document on a fresh dev company → object lands in bucket `<companyId>` at path `<companyId>/...`; no new objects appear in `private`.
2. A file seeded into `private` (legacy) still previews, downloads, and appears in the Documents list; its email-attachment signed URL resolves.
3. Creating a new company (onboarding or `pnpm db:seed:dev`) produces a `storage.buckets` row for it; the first upload succeeds without any manual step.
4. Preview route returns 403 for a bucket that is neither the caller's company bucket, `private`, nor a shared bucket it already legitimately serves (`public`, `temp-staging` — discovered during execution: model raw downloads and DocumentPreview flow through this route); returns 403 for a path outside the caller's company prefix.
5. Customer share route serves files from the portal company's bucket with legacy fallback.
6. MCP file-upload tool mints a signed upload URL targeting the company bucket, and the uploaded file previews.
7. `scripts/migrate-private-buckets.ts` run twice reports the second run as all-skipped (idempotent).
8. `rg 'from\("private"\)'` over `apps/`, `packages/` returns only the `LEGACY_PRIVATE_BUCKET` constant definition/fallback helper internals (and contrib/examples).
9. `pnpm exec turbo run typecheck --filter=@carbon/utils --filter=erp --filter=mes --filter=@carbon/jobs` passes; `packages/utils/src/storage.test.ts` passes.

## Open Questions (resolved — audit trail)

- [x] How do new companies get a bucket? — **Answer:** DB trigger on company insert (user chose recommended option).
- [x] Fallback vs clean break? — **Answer:** Fallback + copy script; fallback removed in a follow-up after verification (user chose recommended option).
- [x] Keep `companyId/` path prefix inside company buckets? — **Answer:** Keep it (user chose recommended option).
- [x] Legacy bucket EOL? — **Answer:** Cleanup deferred ~1 week after prod verification (user: "we will clean it up after a week or so when we have verified all works good now").

## Changelog

- 2026-09-17 — Spec written after interview; 4 user decisions + 7 codebase-settled decisions recorded.
