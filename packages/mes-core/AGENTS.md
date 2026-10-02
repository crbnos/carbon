# @carbon/mes-core

The wire contract shared by the MES API (`apps/mes/app/routes/api+/v1+/`) and the
Carbon MES mobile app (`apps/mobile`): zod schemas for every request and response,
the header names, the error codes, and the lookup queries the app runs directly.

Design record: `.ai/specs/2026-09-30-mes-mobile-app.md`.
Implementation plan: `.ai/plans/2026-10-02-mes-mobile-app.md`.
API conventions: `.claude/rules/mes-mobile-api.md`.

## Always

- Keep this package importable by **Hermes** (React Native). It may depend on
  `zod` and on TYPES from `@carbon/database` / `@supabase/supabase-js` — nothing
  else.
- Give every endpoint a schema here before writing the route, and have the route
  `parse` its own response with it. A server that cannot satisfy the schema fails
  its own test instead of the app's zod at runtime.
- Query functions in `queries.ts` follow the house service shape: `client` first,
  return the raw supabase `{ data, error }`, never throw, and always
  `.eq("companyId", companyId)`.
- Mirror a web zfd validator with a plain-JSON schema, and pin the pair with a
  `expectTypeOf(...).toMatchTypeOf(...)` test — the API takes JSON where the web
  route takes FormData, and the two must accept the same values.

## Ask First

- Changing an existing request or response shape. `/api/v1` is **additive-only**
  (`BACKWARD_COMPATIBILITY.md`): the two most recent store releases must keep
  working, and a self-hosted server can be months behind the app. A breaking
  change needs `/api/v2`.
- Changing `MES_LOCALES` — it is pinned against `lingui.config.js` and shared
  with `@carbon/locale`'s supported list.

## Never

- Never import React, React Native, DOM or Node APIs here.
- Never import `@carbon/env`, `@carbon/auth`, `@carbon/ee` or `@carbon/locale`.
  All four boot the server env at module load and throw in Hermes — that is the
  whole reason `MES_LOCALES` is duplicated in `locales.ts`.
- Never import `@carbon/database` for anything but `import type`.
- Never put server logic here. Commands live in
  `apps/mes/app/services/commands.server.ts`, screen reads in `screens.server.ts`.

## Validation Commands

```bash
pnpm --filter @carbon/mes-core test
pnpm exec turbo run typecheck --filter=@carbon/mes-core
```

## Key Exports

| Export | From | Purpose |
|---|---|---|
| `API_VERSION`, `API_PREFIX` | `./contract` | `1`, `/api/v1` |
| `HEADERS` | `./contract` | Every header name the API reads or sets |
| `ApiErrorCode`, `ApiErrorBody` | `./contract` | The one error shape every endpoint returns |
| `compareAppVersion`, `serverSpeaksApiVersion` | `./contract` | The two-way version checks |
| `authCodeRequest` … `authPasswordRequest` | `./contract` | Sign-in bodies |
| `authSessionResponse` | `./contract` | Tokens plus `mfaRequired` |
| `meResponse`, `MeInstance`, `MePermissions` | `./contract` | What the app learns about an instance |
| `operationsQuery` | `./contract` | The operations list query |
| `MES_LOCALES`, `resolveMesLocale` | `./locales` | The 13 shipped locales |
