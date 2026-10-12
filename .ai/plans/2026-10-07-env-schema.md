# Environment schema — one declaration, clear startup report

Goal: one schema in `@carbon/env`, a grouped startup report, and no Vercel- or
Supabase-specific names in app logic — without changing what any deployment has
to set. Audit taken at `59ed755d52`, re-verified at `c1b539854c`.

## Rules that keep every deployment booting

1. New names fall back to old ones, inside `@carbon/env` only.
2. The report lists everything, but only exits on what exits today
   (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SESSION_SECRET`,
   `REDIS_URL`, `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` unless
   `INNGEST_DEV`). Newly required variables are warnings for one release.
3. A test pins what each real deployment sets and asserts no startup error.
4. A derived OAuth callback never overrides a variable that is set.

## PR 1 — schema, reporter, aliases (no behaviour change)

- [x] `packages/env/src/schema.ts`: every variable once (type, group,
      description, secret, browser, required level, aliases)
- [x] `packages/env/src/validate.ts`: `validateEnv` + `formatReport`, pure
- [x] `index.ts` reads through the schema; named exports unchanged
- [x] `APP_URL` (← `VERCEL_URL`), `APP_ENV` (← `VERCEL_ENV`), `DATABASE_URL`
      (← `SUPABASE_DB_URL`); old exports stay
- [x] `Window.env` type and `getBrowserEnv()` checked against the browser flag
- [x] Reporter tests + deployment test (SST, `crbn up`)
- [x] Deployment test for Vercel (`carbon` and `mes` projects, names read with
      the Vercel CLI on 2026-10-07)
- [ ] Deployment test for the BYOC chart — the chart is not in this repository

## PR 2 — move direct `process.env` reads

- [ ] The direct-only variables into the schema (AI, Resend, Inngest URLs,
      QuickBooks/Xero redirect, `GIT_COMMIT_SHA`, sweep and dev variables)
- [ ] Call sites off `VERCEL_URL` / `VERCEL_ENV` onto `APP_URL` / `APP_ENV`
- [ ] One `DATABASE_URL` precedence in `packages/checks` and `packages/database`
- [ ] Derive the four live OAuth callbacks from the ERP origin when unset
- [ ] `packages/dev/src/env.ts` and `sst.config.ts` write the new names
- [ ] Biome `noProcessEnv` with the exempt list

## PR 3 — housekeeping

- [ ] Generate `.env.example` from the schema + a staleness check
- [ ] Build-affecting variables in `turbo.json`
- [ ] Remove dead exports; move non-env constants out of the env file

## Follow-up release

- [ ] Flip `required: "warn"` and half-configured features to startup errors
- [ ] Remove aliases: `VERCEL_URL`, `VERCEL_ENV`, `SUPABASE_DB_URL`,
      `OPENAI_API_KEY`, `VERCEL_GIT_COMMIT_SHA`, the old QuickBooks webhook name
