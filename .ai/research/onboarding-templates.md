# Research — onboarding "choose a template" + dev seed single source of truth

Date: 2026-08-13. Grounded against committed code on `feat/onboarding-templates`.

## Headline

The template mechanism is ~80% built and **dead at exactly one link**: nothing ever
downloads a template archive or passes `templateIndustryId`. The `template` choice
today provisions the *identical* clean company as `none`; the only durable
difference is `company.industryId` being persisted.

## What already exists (verified)

| Piece | Location | State |
|---|---|---|
| 3-way choice UI (`template` / `import` / `none`) | `apps/erp/app/routes/onboarding+/industry.tsx:230-250` | works |
| Internal-only gate on the whole step | `industry.tsx:87-105`, `:107-114`; `_layout.tsx:46-53` | public signups never see it |
| `industry` catalog table + 3 seeded rows (`robotics_oem`, `precision_manufacturing`, `automotive_precision`) | `migrations/20260617100002_onboarding-and-backups.sql:14-35` | exists, global (no companyId) |
| Private storage bucket `company-templates` | same migration `:61-62` | exists, service-role only |
| `TEMPLATE_BUCKET` constant | `packages/jobs/src/inngest/functions/tasks/company-backup.ts:33` | **zero runtime consumers** |
| Manual template upload script | `ci/src/upload-backup-templates.ts` | `workflow_dispatch` only |
| Import job accepts `templateIndustryId` | `company-import.ts:50,58,256,416`; `packages/lib/src/events.ts:186` | **no caller ever passes it** |
| Committed `robotics_oem.carbon.json.gz` | `packages/database/supabase/backups/` | **deleted** in `d01f0357a`; dir has only README.md |

## The working analogue — "restore from backup"

1. `industry.tsx:252-321` file upload (`.tar.gz`) → hidden `dataChoice=import`.
2. `industry.tsx:149-161` → `provisionOnboardingCompany(..., { backup })`.
3. `apps/erp/app/services/onboarding.server.ts:101-210` — insert company →
   `provisionCompanyData` → `seedCompany(..., { identityOnly: true })`
   (`settings.service.ts:853-867`, edge fn `seed-company`) → location → employee job.
4. `onboarding.server.ts:66-73` — `unpackBackupArchive` streams gunzip+untar into the
   per-company bucket (`backups-archive.server.ts`); one-object upload would 413.
5. `onboarding.server.ts:80-92` — `trigger("company-import", { filePath, mode: "reseed",
   importRunId, autoFinalize: true })` — **Inngest**, not an edge function.

**The single missing hook:** for `dataChoice === "template"`, fetch
`company-templates/<industryId>.carbon.json.gz` server-side and feed the same path,
passing `templateIndustryId`.

## The dev seed (`pnpm db:seed:dev`)

- Entry `packages/database/src/seed-dev.ts` (93 L), tsx/Node, ~6,823 L across
  `packages/database/src/seed-dev/` (cli, sql, types, bootstrap, wipe, helpers, 12 tiers).
- Writes **raw parameterized SQL over a `pg` PoolClient**, one transaction, with
  `SET LOCAL app.sync_in_progress = 'true'` to suppress event dispatch.
- Dataset is **hardcoded TS literals inline in each tier file** (spec arrays at top,
  `runTierN` below) — satellite company "Orbital Systems Inc.", ids `SAT-/BUS-/EPS-/…`.
- 12 tiers in numeric order; ordering IS the contract (`packages/database/AGENTS.md:46-55`).
- Dev-only deps: `SUPABASE_DB_URL` direct Postgres, `SUPABASE_SERVICE_ROLE_KEY` for
  `auth.admin.createUser`, password literal `"password"`, local Supabase assumed.
- `resolveCompany` reuses an existing company by employee email, else `bootstrap.ts`
  creates auth user + company + reference data; `wipe.ts` clears prior business data.

## Existing single-source-of-truth precedent

`packages/database/supabase/functions/lib/seed.data.ts:3` — *"Used by both seed-dev.ts
(Node.js) and seed-company edge function (Deno)"*. Reference data (accounts, currencies,
UoMs, sequences) already lives there and is imported by `bootstrap.ts:9-25`, `sql.ts:2`,
and the Deno `seed-company` function. **`supabase/functions/lib/` is the proven
cross-runtime shared location.**

## Stale docs to fix

- `.claude/rules/company-backup-restore.md` ("Onboarding seed" section) and
  `packages/database/supabase/backups/README.md:26-31` both claim the template branch
  downloads and reseed-imports a `.gz`. It does not. Aspirational, not implemented.

## Related lesson

`.ai/lessons.md:312-320` — editing `seed.data.ts` only reaches NEW companies; existing
companies need a reconciling migration. Applies if template content changes seeded
per-company template rows.
