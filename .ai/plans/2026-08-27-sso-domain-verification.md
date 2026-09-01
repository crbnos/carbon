# Implementation Plan: SSO Domain Verification (DNS TXT)

Spec: `.ai/specs/2026-08-27-sso-domain-verification.md`
Branch: `sso-implementation-research` (feature branch, unmerged — migration edited in place)

Key design point discovered during grounding: the connection lookups
(`getSsoConnection`, `getSsoConnectionByDomain`, `getSsoConnectionByProviderId`)
will attach a computed `domains: string[]` (VERIFIED domains only) to their
returned row, so every downstream consumer — ERP/MES callback `.includes`
check, `uncoveredSsoDomainError`, `getSsoInviteDomainError` — keeps its exact
shape and needs no change.

## Tasks

- [x] 1. Edit `packages/database/supabase/migrations/20260820215433_sso-connection.sql`:
      drop `domains TEXT[]` + GIN index from `ssoConnection`; add `ssoDomain`
      table (id('ssod'), companyId, connectionId, domain, verificationToken,
      status pending|verified CHECK, verifiedAt, audit cols, composite PK,
      composite FK → ssoConnection ON DELETE CASCADE, global UNIQUE(domain),
      indexes, 4 RLS policies mirroring ssoConnection).
      Verify: SQL reviewed; applied to dev DB via user-run delta (end of plan).
- [x] 2. `packages/ee/src/sso/verification.server.ts` (new): token generation,
      `getTxtRecord`, `checkDomainVerification` (pinned resolvers, discriminated
      result, never throws). + `verification.server.test.ts` (mock `node:dns/promises`).
      Verify: `pnpm --filter @carbon/ee test`.
- [x] 3. Rework `packages/ee/src/sso/connections.server.ts`:
      lookups embed `ssoDomain` and attach verified `domains`;
      `upsertSsoConnection` drops domains handling (steal check deleted — DB
      UNIQUE owns it); new `getSsoDomains`, `addSsoDomain`, `verifySsoDomain`,
      `removeSsoDomain` + internal `syncGoTrueDomains`. Export via
      `index.server.ts`. Update `sso.server.test.ts`.
      Verify: `pnpm --filter @carbon/ee test` + typecheck.
- [x] 4. `apps/erp/app/modules/settings/settings.models.ts`: remove `domains`
      from `ssoConnectionValidator`; add `ssoDomainValidator` +
      `PUBLIC_EMAIL_DOMAINS`; update `settings.models.sso.test.ts`.
      Verify: `pnpm --filter erp test -- settings.models.sso` (or vitest path run).
- [x] 5. `apps/erp/app/routes/x+/settings+/sso.tsx`: `addDomain` /
      `verifyDomain` / `removeDomain` intents (reason-specific verify errors).
- [x] 6. `apps/erp/app/routes/x+/settings+/security.tsx`: remove domains input
      from IdP form; add Email Domains card (list + status badge + TXT
      instructions + Verify/Remove + add form); requireSso hint when zero verified.
- [x] 7. Callbacks + invite paths: no code change needed (shape preserved) —
      re-read to confirm; MES same.
- [x] 8. Docs + docs-sync: `docs/content/docs/platform/single-sign-on.mdx` +
      agent-KB mirror; `.claude/rules/authentication-system.md` SSO section;
      `packages/ee/AGENTS.md`; spec changelog.
- [x] 9. Validation: regenerate types after user applies DB delta;
      `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp --filter=mes`;
      `pnpm run lint`; `pnpm --filter @carbon/ee test`.

## DB delta for already-applied dev DBs (user-run)

```sql
DROP INDEX IF EXISTS "ssoConnection_domains_idx";
ALTER TABLE "ssoConnection" DROP COLUMN IF EXISTS "domains";
-- then the ssoDomain CREATE TABLE + indexes + RLS block from the edited migration
```

## Build-time verifications

- GoTrue admin API accepts `domains: []` on create (assumed from GoTrue source;
  runtime-verified by the user's carbon.ms test). Fallback if refused: create
  provider lazily at first verification (providerId nullable) — NOT implemented
  unless needed.
