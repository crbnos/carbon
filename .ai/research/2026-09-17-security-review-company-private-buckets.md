# Security review — company-private buckets (feat/supabase-bucket-migration)

Three-track review (tenant isolation / data loss / attacker-controlled input) of the
uncommitted branch diff, 2026-09-17. Headline: **no branch-introduced cross-tenant
access and no scenario that deletes or orphans a customer file today.** The preview
route's new `isPrivateBucket` gate actually *closes* a HEAD hole (any URL-supplied
bucket id was previously accepted). Remaining findings are pre-existing exposures the
branch preserved, plus deploy-sequencing risks — listed worst-first.

## Fix before merge (small, high-value)

1. **Assert the tenant prefix inside the fallback helpers** — `downloadCompanyPrivateObject`
   and `createCompanyPrivateSignedUrl` (`packages/utils/src/storage.ts:123-129, 152-166`)
   fall back to legacy `private` with the raw `objectPath` unchecked against `companyId`.
   Under a service-role client the path string is the only tenant boundary. Adding
   `hasCompanyPrivateObjectPathPrefix(companyId, objectPath)` inside both helpers closes
   findings 2 and 3 below in one place.
   - Caveat: audit archives write company-bucket keys as `audit-logs/${companyId}/...`
     (`packages/jobs/src/inngest/functions/scheduled/audit-archive.ts:69`) — NOT
     companyId-prefixed, violating the module invariant (and making the legacy fallback
     in `packages/database/src/audit.ts:365-377` fail RLS for user clients). Either
     re-key archives to `${companyId}/audit-logs/...` or exempt that caller explicitly.
2. **`download.$token.tsx` cross-tenant legacy read (Medium, pre-existing)** —
   `apps/erp/app/routes/download.$token.tsx:50-54`: `document.path` content is never
   validated against the company prefix; a company-A user who can write a `path` of
   `companyB/<key>` gets B's bytes via the service-role legacy fallback. Fixed by #1
   (or a local `hasCompanyPrivateObjectPathPrefix` check like the share route already does).
3. **`import-csv` edge fn cross-tenant legacy read (Medium, pre-existing)** —
   `packages/database/supabase/functions/import-csv/index.ts:973-976`: `filePath` is
   client-supplied (`z.string().min(1)` only), client is service-role; the legacy
   fallback reads any `<otherCo>/....csv` at a known key. Add
   `if (!filePath.startsWith(companyId + "/")) throw` before the download.
4. **Empty-companyId bucket (Medium, net-new edge)** — `getCompanyPrivateBucket("")`
   returns `""` (`packages/utils/src/storage.ts:16`); with `path.split("/")[0] ?? ""`
   derivations, `.from("")` gets probed (harmless miss) but the legacy fallback still
   runs with the raw path. Make `getCompanyPrivateBucket` throw (or callers guard) on
   empty input.
5. **Reserved bucket ids in the trigger (Low, defense-in-depth)** —
   `20260917163108_company-bucket-provisioning.sql:22-34`: if a `company.id` ever equaled
   `private`/`public`/`avatars`/`feedback`/`temp-staging`/`company-templates`, the
   `ON CONFLICT DO NOTHING` silently no-ops while the "Company bucket access" RLS policy
   would grant that company's employees FOR ALL on the shared bucket. Not reachable
   today (ids are generated, no user-supplied company insert path), but exclude reserved
   ids in the trigger + backfill.

## Separate urgent ticket (NOT this branch)

- **Unauthenticated cross-tenant model read (High, pre-existing)** —
  `apps/erp/app/routes/file+/model+/public.$.tsx:33-66`: no `requirePermissions`,
  "companyId" is derived from the attacker-supplied path itself, only gate is
  `path.includes("models")` + extension; serves from legacy `private` (and now company
  buckets) with `Access-Control-Allow-Origin: *` and long-lived caching. Anyone with a
  guessable key reads any tenant's model/PDF/image under a `models` segment. Same reach
  on HEAD — the branch didn't widen it materially — but it is the weakest point found.
  Fix: require auth (or a signed token) + `path.startsWith(companyId + "/")`.

## Deploy / operational risks (data-loss track)

- **H1 — copy script coverage claim is false for non-companyId prefixes.**
  `scripts/migrate-private-buckets.ts:101` lists only `<companyId>/` prefixes; legacy
  audit archives at `audit-logs/<companyId>/...` (and prefixes of deleted companies)
  are never copied. Safe today (readers fall back), but decommissioning the legacy
  bucket on the script's "copied everything" claim would permanently destroy
  pre-migration audit archives. Fix the docblock now; extend the script (or migrate
  `audit-logs/` explicitly) before fallback removal.
- **H2 — deploy order.** Companies created after 2025-08-27 have no bucket until
  `20260917163108` applies. App code writes company-bucket-only → apply the migration
  before (or atomically with) the app deploy, else uploads for those tenants fail
  loudly ("Bucket not found") until it lands.
- **M1 — 50MB cap vs older legacy files.** Legacy `private` was uncapped until
  2026-07-15; company buckets are capped at 52428800. Oversized legacy objects would
  fail to copy (loud, script exits 1) and stay pinned to legacy. One-time check of
  legacy object sizes before the prod copy run; raise/drop the cap if any exceed it.
- **M2 — backup listing silently incomplete (pre-existing).** `listBucketFilesRecursive`
  (`packages/jobs/src/inngest/functions/tasks/company-export.ts:472-496`) swallows list
  errors and does no pagination (>1000 direct children in a folder are dropped) while
  reporting success. Backup is the safety net for this exact migration — worth fixing
  alongside.
- **M3 — restore overwrite deletes before re-copy** (`company-backup.ts:604-614`):
  duplicate → `remove` live object → retry copy; a failed retry leaves the live object
  gone (backup copy survives). Narrow, user-initiated, pre-existing.
- **M4 — `.move()` is company-bucket-only** (`x+/quote+/$quoteId.drag.tsx:309-320`,
  `x+/sales-rfq+/$rfqId.drag.tsx:165`): a file present in both buckets moves only the
  company copy; the stale legacy copy is resurrected forever by the list union and no
  delete ever targets the old legacy path.
- Low: several `removeCompanyPrivateObjects` callers ignore returned `errors`
  (production.service.ts:6824/6891, drag routes, model-thumbnail.ts:132) — a failed
  legacy-side delete leaves a resurrectable copy silently. Files uploaded to legacy by
  old pods during the deploy window stay legacy-only — re-run the copy script before
  removing fallback.

## Verified safe (with evidence)

- **RLS**: "Company bucket access" (`20250827181005_company-bucket-rls.sql:95-103`)
  scopes `bucket_id = ANY(get_companies_with_employee_role())`; legacy policy prefix-
  scopes `foldername(name)[1]`. `FOR ALL ... USING` doubles as WITH CHECK — employee of
  A cannot touch B's bucket or B's legacy prefix via a user JWT.
- **Trigger**: SECURITY DEFINER with pinned `search_path`, `NEW.id` used only as a
  parameterized value (no dynamic SQL → no injection), `RETURNS TRIGGER` so not
  directly invocable; bucket creation bounded 1:1 with company inserts.
- **Preview routes**: bucket allowlist (own bucket / legacy / public / temp-staging) +
  `ownsPath` + fallback reuses the same checked path; naming another company's bucket
  → 403. URL-decoding tricks don't bypass (decode happens before matching).
- **Share route**: companyId from the share record, prefix guard + 3 further
  job/customer checks + 10/min rate limit.
- **Uploads / MCP**: `companyId` injected from auth, keys always
  `${companyId}/...`-prefixed, signed upload URLs target the caller's own bucket only.
- **Copy script**: zero delete calls; `copy()` without upsert → existing destination
  409s and is counted `skipped` (idempotent, can never clobber newer data); correct
  1000-page offset pagination + folder recursion.
- **No missed readers/writers**: repo-wide grep leaves exactly one `.from("private")` —
  the import-csv read *fallback*. Every traced reader has company→legacy fallback; all
  private deletes go through the dual-bucket helper; `cleanup.ts` never prunes a
  referenced object without a durable copy in either private bucket.
- **Backup/restore**: export unions both buckets (company copy wins); restore writes
  to the company bucket, which every reader checks first.
