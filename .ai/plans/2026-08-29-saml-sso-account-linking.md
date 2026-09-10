# SAML SSO account linking — implementation plan

**Spec:** .ai/specs/2026-08-29-saml-sso-account-linking.md (see §0 Design revision v2 — authoritative)
**Branch:** little-rock
**Posture:** staff-operated v1; app-layer (no DB triggers T1–T4); reuse `ssoConnection`/`ssoDomain`;
provider-agnostic linking keyed on the `auth.identities.email` column. Full code + unit tests +
migration rollback-validation; **draft PR flagged e2e-unverified** (needs a SAML env + the
`crbnos/supabase` fork's `GOTRUE_DISABLE_SIGNUP=true` + Kong/allow-list fixes — not in this repo).

## Progress
- [ ] Task 1: Pre-seed helpers in `provisioning.server.ts` (+ pure unit-tested builders)
- [ ] Task 2: Wire backfill + audit into `verifySsoDomain`; wire removal into `removeSsoDomain`
- [ ] Task 3: Seed newly-invited users in the three account-creation flows
- [ ] Task 4: Migration — `auth.sso_domains` guard trigger + `ssoReservedDomain` (defense-in-depth)
- [ ] Task 5: Unit tests + migration rollback-validation script
- [ ] Task 6: Docs (AGENTS.md, spec→implemented note) + draft PR

## Dependencies
- Task 2, 3 need Task 1 (helpers). Task 4 is independent of 1–3. Task 5 needs 1–4. Task 6 last.

---

## Task 1: Pre-seed helpers in provisioning.server.ts

**Files:**
- Modify: `packages/ee/src/sso/provisioning.server.ts` — add three server helpers + two pure builders.
- Copy from (precedent): `linkSsoIdentityToUser` in the same file (raw `sql` over `auth.identities`,
  `{ data, error }` return, `try/catch` + logger).

**Steps:**
1. Add a pure, exported, unit-testable builder:
   ```ts
   // The provider column value for a GoTrue SSO provider id.
   export function ssoProviderColumn(providerId: string): string {
     return `sso:${providerId}`;
   }
   // The lowercased domain of an email, or null. Mirrors uncoveredSsoDomainError's split.
   export function emailDomain(email: string): string | null {
     return email.split("@")[1]?.trim().toLowerCase() ?? null;
   }
   ```
2. `seedSsoIdentityForUser(db, { userId, email, providerId })` — insert ONE pre-seed row. The
   load-bearing match is the generated `email` column (`lower(identity_data->>'email')`); `provider_id`
   is a readable placeholder. Provider-agnostic (works for any IdP via GoTrue's email fallback).
   ```sql
   INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
   VALUES (${lowerEmail}, ${userId}::uuid,
           jsonb_build_object('sub', ${lowerEmail}::text, 'email', ${lowerEmail}::text),
           ${'sso:' + providerId}, now(), now())
   ON CONFLICT (provider_id, provider) DO NOTHING
   ```
   Return `{ data: { seeded: boolean } | null, error }`. Lowercase the email in TS before binding.
3. `backfillSsoIdentitiesForDomain(db, { providerId, domain })` — set-based seed of every existing
   non-SSO user on the domain (adopted policy §4: verified owner controls the domain instance-wide, so
   NOT company-scoped). Return the linked user ids for audit.
   ```sql
   INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
   SELECT lower(u.email), u.id,
          jsonb_build_object('sub', lower(u.email), 'email', lower(u.email)),
          ${'sso:' + providerId}, now(), now()
   FROM auth.users u
   WHERE u.email IS NOT NULL AND u.is_sso_user = false
     AND lower(split_part(u.email, '@', 2)) = ${lowerDomain}
   ON CONFLICT (provider_id, provider) DO NOTHING
   RETURNING user_id
   ```
   Return `{ data: { linkedUserIds: string[] } | null, error }`.
4. `removeSsoIdentitiesForDomain(db, { providerId, domain })` — delete this domain's SSO identities,
   keyed on the `email` column so it also catches GoTrue's self-healed opaque-NameID rows:
   ```sql
   DELETE FROM auth.identities
   WHERE provider = ${'sso:' + providerId}
     AND lower(split_part(email, '@', 2)) = ${lowerDomain}
   ```
   Return `{ data: { removed: number } | null, error }`.
5. Match the existing file's error handling exactly (logger.error + `{ data: null, error }`).

**Verify:**
```bash
pnpm --filter @carbon/ee typecheck
# Expected: no errors
```

**Out of scope:** touching `linkSsoIdentityToUser` / `migrateUserToSso` / `deleteJitSsoUser` (the
DISABLE_SIGNUP=false repair path — left intact as a fallback), `is_sso_user`.

---

## Task 2: Wire backfill + audit into verifySsoDomain; removal into removeSsoDomain

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/sso/connections.server.ts` — add a `db: Kysely<KyselyDatabase>` param to
  `verifySsoDomain` and `removeSsoDomain`; call the Task-1 helpers after the existing success writes.
- Modify: `apps/erp/app/routes/x+/settings+/sso.tsx` — pass `getDatabaseClient()` at both call sites
  (`intent === "verifyDomain"`, `intent === "removeDomain"`).
- Audit: import `insertAuditLogEntries` from `@carbon/database` (see `packages/database/src/audit.ts:205`).

**Steps:**
1. `verifySsoDomain(serviceRole, db, args)`: after the `update` at line 345–356 succeeds (row flipped
   to `verified`), call `backfillSsoIdentitiesForDomain(db, { providerId: connection.data.providerId,
   domain: row.data.domain })`. On its error, log and continue (verification already committed — do NOT
   fail the verify). Then best-effort audit (wrapped in try/catch, never throws):
   `insertAuditLogEntries(serviceRole, args.companyId, [{ tableName: "auth.identities", entityType:
   "ssoIdentityBackfill", entityId: row.data.domain, recordId: row.data.domain, operation: "INSERT",
   actorId: args.userId, diff: null, metadata: { domain, providerId, linkedCount, requestId: null,
   ipAddress: null, userAgent: null, origin: null } }])` — confirm the exact `CreateAuditLogEntry`
   shape in `packages/database/src/audit.types.ts` and match it. If audit is disabled for the company
   the RPC errors — swallow + log (a privilege event we try to record, but must not block verify).
2. `removeSsoDomain(serviceRole, db, args)`: after the row is deleted and GoTrue re-synced (line 388+),
   if `wasVerified`, call `removeSsoIdentitiesForDomain(db, { providerId: connection.providerId, domain:
   row.data.domain })`. Needs the connection's providerId — read it via `getSsoConnection` as the
   existing `wasVerified` branch already does (line 402). On error, log + continue.
3. Update `sso.tsx`: `import { getDatabaseClient } from "~/services/database.server";` and pass it as the
   new 2nd arg in both calls.

**Verify:**
```bash
pnpm --filter @carbon/ee typecheck && pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** changing the shipped GoTrue-sync ordering in verify/remove (its lockout-avoidance
reasoning is load-bearing — the guard in Task 4 is designed around it).

---

## Task 3: Seed newly-invited users in the three account-creation flows

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/users/users.server.ts` — after each of `createEmployeeAccount`,
  `createCustomerAccount`, `createSupplierAccount` resolves the auth user id and creates the user,
  seed an SSO identity when the email's domain already has a verified connection.
- Read first: the three flows (around L293/408/549 per the code map) to find the exact point after
  `resolveAuthUserId` + `createUser` where `userId`, `email`, a service-role client, and a db handle
  are all in scope.

**Steps:**
1. Add a small server helper (co-located, e.g. in `users.server.ts` or a thin wrapper over Task 1):
   `maybeSeedSsoIdentity(serviceRole, db, { userId, email })` that calls `getSsoConnectionByDomain`
   (`@carbon/ee/sso.server`) for `emailDomain(email)`; if a verified connection exists, calls
   `seedSsoIdentityForUser(db, { userId, email, providerId: connection.providerId })`. Best-effort:
   log on error, never throw (account creation must not fail because seeding failed — the user still
   works via the backfill path or the callback repair fallback).
2. Call it in all three flows after the account row + auth user exist. If any flow lacks a Kysely db
   handle, thread `getDatabaseClient()` from the caller — **if a flow's shape makes this unsafe
   (e.g. it runs before the auth user is committed), STOP and report; do not reorder account creation.**
3. `isSsoEnabled()` self-gates `getSsoConnectionByDomain`, so off-Enterprise this is a no-op.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** the invite-acceptance / callback flow (already handled by `migrateUserToSso`).

---

## Task 4: Migration — auth.sso_domains guard + ssoReservedDomain (defense-in-depth)

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<ts>_sso-domain-guard.sql` via
  `pnpm db:migrate:new sso-domain-guard` (never `000000` HHMMSS).

**Steps:**
1. `ssoReservedDomain` table: `("domain" TEXT PRIMARY KEY)`, seeded with the same values as
   `PUBLIC_EMAIL_DOMAINS` in `apps/erp/app/modules/settings/settings.models.ts` PLUS Carbon-own domains
   (`carbon.ms`, `carbon.us.org`, `carbonms.onmicrosoft.com` — verify current list). Add a header
   comment cross-referencing `PUBLIC_EMAIL_DOMAINS` to keep them in sync. This table is NOT
   company-scoped (global reserved list) — RLS: enable + a permissive `SELECT` for authenticated,
   no write policy (staff/service-role only). Use `INSERT ... ON CONFLICT DO NOTHING` for idempotency.
2. Guard function + trigger on `auth.sso_domains` (precedent: `create_public_user` on `auth.users`,
   `SECURITY DEFINER SET search_path = public` per house convention):
   ```sql
   CREATE OR REPLACE FUNCTION auth.enforce_sso_domain_claim() RETURNS TRIGGER
   LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
   BEGIN
     IF current_setting('app.sso_domain_override', true) = 'on' THEN RETURN NEW; END IF;
     IF EXISTS (SELECT 1 FROM public."ssoReservedDomain" WHERE lower("domain") = lower(NEW."domain")) THEN
       RAISE EXCEPTION 'auth.sso_domains insert blocked: % is a reserved domain', NEW."domain";
     END IF;
     IF NOT EXISTS (SELECT 1 FROM public."ssoDomain" WHERE lower("domain") = lower(NEW."domain")) THEN
       RAISE EXCEPTION 'auth.sso_domains insert blocked: no ssoDomain claim for %', NEW."domain";
     END IF;
     RETURN NEW;
   END $$;
   DROP TRIGGER IF EXISTS enforce_sso_domain_claim ON auth.sso_domains;
   CREATE TRIGGER enforce_sso_domain_claim BEFORE INSERT ON auth.sso_domains
     FOR EACH ROW EXECUTE FUNCTION auth.enforce_sso_domain_claim();
   ```
   NOTE: requires a *claim row* (any status), NOT `verified`, because the shipped `verifySsoDomain`
   syncs GoTrue (which writes `auth.sso_domains`) while the row is still `pending` — a verified-only
   guard would break the happy path or force a lockout-prone reorder. Reserved domains can never get a
   claim row via the app validator anyway; the reserved check makes that hold in-DB too.
3. Idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`.
4. `pnpm run generate:types` after — **only if the local DB is reachable and the migration applies.**
   `ssoReservedDomain` is not referenced from TS (guard is SQL-only), so a types regen is not required
   to typecheck. If the DB is not reachable, document the regen as a deploy step. **Do NOT rebuild the
   DB to test — wait for the user.**

**Verify:**
```bash
# Rolled-back psql transaction (see Task 5). Do not run a full db:migrate rebuild.
```

**Out of scope:** touching `auth.sso_providers`, `create_public_user`, or the `ssoDomain`/`ssoConnection`
tables' definitions.

---

## Task 5: Unit tests + migration rollback-validation

**Depends on:** Tasks 1–4
**Files:**
- Create: `packages/ee/src/sso/provisioning.test.ts` (or extend an existing sibling test) — pure-fn tests
  for `emailDomain`, `ssoProviderColumn` (edge cases: no `@`, uppercase, whitespace, subdomains).
- Create: `.ai/runs/2026-08-29-sso-domain-guard-rollback.sql` — a BEGIN/…/ROLLBACK script (precedent:
  memory `reference_migration_rollback_validation`) asserting: (a) inserting `auth.sso_domains` for a
  domain with a `ssoDomain` claim succeeds; (b) without a claim → RAISES; (c) for a reserved domain →
  RAISES; (d) with `set_config('app.sso_domain_override','on',true)` → succeeds. Run via `supabase_admin`
  if the DB is reachable; otherwise leave it as a documented validation artifact.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: new tests pass
```

**Out of scope:** e2e SAML flow (env-gated — documented in the PR, not tested here).

---

## Task 6: Docs + draft PR

**Depends on:** Tasks 1–5
**Files:**
- Modify: `packages/ee/AGENTS.md` — add the new `provisioning.server.ts` exports + the pre-seed model to
  the SSO bullet.
- Modify: `.claude/rules/authentication-system.md` — if it documents the SSO linking flow, add the
  pre-seed/DISABLE_SIGNUP=true model (read first; only if it covers this).
- Modify: `.ai/specs/2026-08-29-saml-sso-account-linking.md` — leave in place; move to
  `specs/implemented/` only after e2e verification (it is not verified here).
- Commit via `/check-and-commit`; open a **draft** PR onto `main` with the deployment prerequisites and
  the e2e-unverified flag spelled out.

**Verify:**
```bash
gh pr view --json isDraft,title
# Expected: isDraft = true
```
