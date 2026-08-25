# Enterprise SAML SSO — implementation plan

**Spec:** .ai/specs/2026-08-21-enterprise-saml-sso.md
**Research:** .ai/research/sso.md
**Branch:** victoria

> **HISTORICAL RECORD — several planned flows were later superseded.** This plan
> describes what was built at execution time; the spec's Changelog is the source
> of truth for the final design. In particular: the archival/reassignment flow
> (Task 6) was replaced by **link-instead-of-archive** (nothing is deactivated;
> `reassignUserReferences`/`REASSIGNABLE_USER_COLUMNS` were deleted as dead
> code); the "Users to re-invite" card (Task 9 step 5) became "Covered Users"
> and was later removed entirely (coverage is documented on the Identity
> Provider card instead); and the controlled-environment TOTP exception
> (Task 10) was removed — SSO sessions skip the MFA gate in EVERY environment.
> Do not reintroduce these flows from this document.

## Progress
- [x] Task 1: Migration — `ssoConnection` table + crash-free `create_public_user` (`20260820215433_sso-connection.sql`)
- [x] Task 2: Apply migration + regenerate types (applied via `pnpm db:migrate`; ssoConnection in types.ts, 4 RLS policies confirmed in DB)
- [x] Task 3: Add `"sso"` auth provider to env (typecheck green)
- [x] Task 4: `@carbon/auth/sso.server` — GoTrue admin wrappers + session helper (typecheck green)
- [x] Task 5: SSO connection validator + service functions. Validator barreled via `~/modules/settings`; service fns in `settings.server.ts` (NOT barreled — deliberate, service-role imports must not leak to browser; import `~/modules/settings/settings.server` directly); MES copy at `apps/mes/app/services/sso.service.ts`. Typecheck green.
- [x] Task 6: `reassignUserReferences` + `migrateUserToSso` transaction (`users.sso.server.ts`). Deviations (schema-forced, documented in-file): list is 39 entries not 43 (`part.assignee`/`service.assignee` moved to `item` by 20240601210618; `nonConformanceInvestigationTask` dropped by 20251120214020; `approvalRequest.approverId` dropped by 20260204204700) — `satisfies` guard makes the list compile-time-checked against Kysely schema; fresh-user-without-old-account edge throws "re-invite" instead of guessing an employeeType. Typecheck green.
- [x] Task 7: Callback SSO branch (ERP + MES). ERP: provider→connection→company binding, domain enforcement w/ orphan cleanup, invite lookup (ilike), migrateUserToSso w/ multi-company + generic error flashes, company binding + group re-resolve, AccountLockout reset, CONTROLLED_ENVIRONMENT TOTP gate vs `mfaVerified: true`, company cookie always set. MES: same enforcement, no migration (flash "complete first SSO sign-in in Carbon ERP"); `getSsoConnectionByProviderId` added to MES sso.service. All 5 packages typecheck green; biome clean.
- [x] Task 8: Login "Continue with SSO" (ERP + MES) + public domain-check API route. Public `/api/sso/check` in BOTH apps (assertIsPost, `sso-check:{ip}` sliding-window 20/1h, boolean-only `{ enabled }` reply; MES has its own api+ route + `path.to.api.ssoCheck`); "Continue with SSO" button + email-first handler on both login pages; `?email=` prefill via ValidatedForm defaultValues. Typecheck green (erp + mes).
- [x] Task 9: Settings → SSO screen + nav + paths. `x+/settings+/sso.tsx` (Enterprise redirect, settings perms, intent-branched action, SP-details Card with `Copy` from @carbon/react, ValidatedForm, deactivate confirm modal inlined from ConfirmDelete pattern, re-invite card via existing `getEmployees`); nav entry Enterprise-gated via `useFlags().isEnterprise`. Note: `defaultValues.domains` carries an `as unknown as string[]` cast (zfd transform output type vs form input string — commented in-file). Typecheck + biome green.
- [x] Task 10: MFA exemption for SSO sessions. `ssoProviderId?` on AuthSession (types.ts), preserved in refreshAuthSession beside mfaVerified; ERP + MES shell `requireMfa` gates exempt SSO sessions unless CONTROLLED_ENVIRONMENT. `requireAuthSession` bounce verified to honor `mfaVerified` at mint (session.server.ts:346) — no change needed there. `path.to.sso` + `path.to.api.ssoCheck` pre-staged in path.ts.
- [x] Task 11: SSO-aware invite emails. `getInviteLink(serviceRole, email, code)` in users.server.ts (falls back to code link on lookup error); wired into employees.new / customers.new / suppliers.new / resend-invite (single path); bulk path inlined in jobs user-admin.ts (cannot import ERP modules). Typecheck green (erp + @carbon/jobs).
- [x] Task 12: GoTrue SAML config (dev + prod compose, .env.example). Routing verified: kong.yml has NO key-auth plugin anywhere and the `auth-v1` catch-all proxies `/auth/v1/` → GoTrue with CORS only; prod bind-mounts the same kong.yml behind Caddy's wholesale `reverse_proxy kong:8000` — SAML ACS/metadata endpoints pass through in dev and prod with no change.
- [x] Task 13: Unit tests. `users.sso.server.test.ts` (19 tests: archived email, multi-company predicate, permission merge/remove round-trips incl. "0" wildcard, REASSIGNABLE_USER_COLUMNS audit-exclusion invariants) + `packages/auth/src/services/sso.server.test.ts` (5 tests: provider-id extraction). All pass; full @carbon/auth suite still green (36 tests). Note: ERP has no package.json `test` script — invoke `pnpm --filter erp exec vitest run <pattern>`. DB-backed transactional test skipped (no Kysely test harness exists; per plan, not built).
- [x] Task 14 (automated gates): typecheck green across @carbon/env, @carbon/auth, @carbon/jobs, erp, mes; biome clean on all SSO files; unit tests pass. **Kong fix discovered during verification**: GoTrue self-declares entityID/ACS WITHOUT /auth/v1 (from API_EXTERNAL_URL) and validates assertion Destination against it — added `auth-v1-sso` service to kong.yml routing `/sso/` → gotrue (fixes dev AND prod, same bind-mounted file); settings screen now displays the canonical un-prefixed URLs. Verified live: `/sso/saml/metadata` returns 200 with real SP metadata. Browser walkthrough vs a mock IdP: pending user go-ahead.
- Gotcha (dev ops): `crbn reload` passes only `--env-file .env.local` to compose — root `.env` vars referenced by docker-compose (SAML_ENABLED, SAML_PRIVATE_KEY) must be exported in the shell when reloading gotrue, or it comes back with SAML off. `crbn up` (run by the user normally) loads them fine.

## Dependencies
- Task 2 needs Task 1. Tasks 4–6 need Task 2 (generated types) and Task 3.
- Task 7 needs Tasks 4, 5, 6. Task 8 needs Tasks 3, 5. Task 9 needs Tasks 4, 5.
- Task 10 needs Task 7. Task 11 needs Task 5. Task 12 independent (can run anytime).
- Task 13 needs Tasks 6, 7. Task 14 last.
- Independent groups after Task 3: {4}, {5}, {12} may run in parallel; then {6}, {8 (api route part)}.

## Design refinements forced by the schema sweep (surfaced for user review)

> **SUPERSEDED** — see the spec changelog (`.ai/specs/2026-08-21-enterprise-saml-sso.md`): SSO is now self-hosted-only and existing active accounts are LINKED (never archived), so the multi-company block, archival, and reassignment machinery below were deleted.

1. **`user.email` UNIQUE index** (`index_user_email_key`, `20230123004116_users-and-companies.sql:16`) + `create_public_user()` conflicting only on `(id)` means a duplicate-email SSO signup crashes the trigger inside GoTrue's own transaction — the SAML login would fail opaquely before Carbon code runs. Fix: the trigger skips the `public."user"` insert when the email belongs to a DIFFERENT id (no mutation of the old row — a rogue IdP must not be able to touch it). The callback migration transaction then owns creating the new row after domain+invite verification.
2. **Multi-company old accounts are BLOCKED from SSO migration in v1.** If the same-email old user has `userToCompany` rows in companies other than the SSO company, archiving their email/account would break their other-company logins. The callback rejects with a clear flash ("this account belongs to multiple companies — contact support"). Single-company accounts (the normal case) migrate automatically. This is a documented v1 limitation, echoed in the spec changelog.
3. **Old-account archival**: within the migration transaction the old `public."user"` row gets `active = false` and its email rewritten to `sso-archived+{oldId}+{originalEmail}` (frees the unique index; the `employees` view already filters `u.active = TRUE` so the mangled email is never displayed). Post-commit, the old `auth.users` account is deleted via the admin API (revokes its sessions; auth-level email freed). `fullName` is untouched, so audit references still render the person's name.
4. **Reassignment column list** (mutable, forward-looking, company-scoped — from the FK sweep):
   - `assignee` on: `changeOrder`, `changeOrderActionTask`, `customer`, `item`, `job`, `jobOperation`, `maintenanceDispatch`, `nonConformance`, `nonConformanceActionTask`, `nonConformanceApprovalTask`, `nonConformanceInvestigationTask`, `nonConformanceReviewer`, `part`, `pickingList`, `procedure`, `purchaseInvoice`, `purchaseOrder`, `purchasingRfq`, `qualityDocument`, `quote`, `receipt`, `riskRegister`, `salesOrder`, `salesOrderShipment`, `salesRfq`, `service`, `shipment`, `stockTransfer`, `supplier`, `supplierQuote`, `training`
   - `quote.salesPersonId`, `quote.estimatorId`, `quoteLine.estimatorId`, `salesRfq.salesPersonId`, `salesOrder.salesPersonId`, `approvalRequest.approverId`, `employeeJob.managerId`, `costCenter.ownerId`, `purchaseOrderLine.ownerId`, `purchaseInvoiceLine.ownerId`, `supplierQuoteLine.ownerId`, `workflow.ownerId`
   - **Excluded by policy**: all audit actors (`createdBy`, `updatedBy`, `closedBy`, `postedBy`), `workflowRun.ownerId` (historical record), `companyGroup.ownerId` (group-scoped, not company-scoped).

---

## Task 1: Migration — `ssoConnection` table + crash-free `create_public_user`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_sso-connection.sql` (via `pnpm db:migrate:new sso-connection`; verify HHMMSS ≠ `000000` and timestamp is newer than the newest existing migration)
- Copy from (precedent): `packages/database/supabase/migrations/20260810100100_workflows-foundation.sql` (table + RLS block), `20260319000000_console-mode.sql` (trigger body being replaced)

**Steps:**
1. `pnpm db:migrate:new sso-connection`
2. Write exactly:

```sql
CREATE TABLE IF NOT EXISTS "ssoConnection" (
    "id" TEXT NOT NULL DEFAULT id('sso'),
    "companyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "domains" TEXT[] NOT NULL,
    "metadataUrl" TEXT,
    "metadataXml" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "ssoConnection_providerId_key" UNIQUE ("providerId"),
    CONSTRAINT "ssoConnection_metadata_check" CHECK (num_nonnulls("metadataUrl", "metadataXml") = 1)
);

CREATE INDEX IF NOT EXISTS "ssoConnection_companyId_idx" ON "ssoConnection" ("companyId");
CREATE INDEX IF NOT EXISTS "ssoConnection_createdBy_idx" ON "ssoConnection" ("createdBy");
CREATE INDEX IF NOT EXISTS "ssoConnection_updatedBy_idx" ON "ssoConnection" ("updatedBy");
CREATE INDEX IF NOT EXISTS "ssoConnection_domains_idx" ON "ssoConnection" USING GIN ("domains");

ALTER TABLE "ssoConnection" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."ssoConnection"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."ssoConnection"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."ssoConnection"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."ssoConnection"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

-- Crash-free public-user creation: an SSO signup whose email already belongs to a
-- DIFFERENT public."user" row must not violate index_user_email_key inside GoTrue's
-- transaction. The row is skipped here; the SSO callback's migration transaction owns
-- creating it after domain + invite verification. The existing row is never mutated
-- from this trigger (a rogue IdP must not be able to touch it).
CREATE OR REPLACE FUNCTION public.create_public_user()
RETURNS TRIGGER AS $$
DECLARE
  full_name TEXT;
  name_parts TEXT[];
  email_owner TEXT;
BEGIN
  SELECT "id" INTO email_owner FROM public."user" WHERE "email" = NEW.email;
  IF email_owner IS NOT NULL AND email_owner <> NEW.id::text THEN
    INSERT INTO public."userPermission" ("id") VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  full_name := NEW.raw_user_meta_data->>'name';
  IF full_name IS NOT NULL THEN
    name_parts := regexp_split_to_array(full_name, '\s+');
    INSERT INTO public."user" ("id","email","active","firstName","lastName","about")
    VALUES (NEW.id, NEW.email, true,
            COALESCE(name_parts[1], ''),
            COALESCE(array_to_string(name_parts[2:], ' '), ''), '')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  ELSE
    INSERT INTO public."user" ("id","email","active","firstName","lastName","about")
    VALUES (NEW.id, NEW.email, true, '', '', '')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  END IF;
  INSERT INTO public."userPermission" ("id") VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

3. Keep the rest of the trigger definition identical to `20260319000000_console-mode.sql` (do not re-create the trigger itself — `CREATE OR REPLACE FUNCTION` suffices; the `on_auth_user_created` trigger already points at this function). If the console-mode migration's function body has drifted from what is shown above (compare before writing), STOP and report — do not merge blindly.

**Verify:**
```bash
grep -c "CREATE POLICY" packages/database/supabase/migrations/*_sso-connection.sql
# Expected: 4
```

**Out of scope:** No `companySettings` columns; no seed data; no RPCs (so no PostgREST reload concern).

## Task 2: Apply migration + regenerate types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts` — regenerated, never hand-edited

**Steps:**
1. `pnpm db:migrate` (applies pending migrations to the worktree's local DB and regenerates types + swagger). If the local DB at `127.0.0.1:$PORT_DB` is unreachable, STOP and report — do not attempt `db:build` (does not exist) and never rebuild the DB.

**Verify:**
```bash
grep -n "ssoConnection" packages/database/src/types.ts | head -3
# Expected: ssoConnection table types present (Row/Insert/Update entries)
```

**Out of scope:** any manual edit to `types.ts`.

## Task 3: Add `"sso"` auth provider to env

**Depends on:** none
**Files:**
- Modify: `packages/env/src/index.ts` — `AuthProvider` union (L116) gains `"sso"`; no change to the `AUTH_PROVIDERS` default string

**Steps:**
1. Change `export type AuthProvider = "email" | "google" | "azure" | "passkey";` to include `| "sso"`.
2. Do NOT add `"sso"` to the default `"email,google,azure"` — it is opt-in via env.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/env
# Expected: exit 0
```

**Out of scope:** browser-exposed env keys (`getBrowserEnv`) — `AUTH_PROVIDERS` is already exposed.

## Task 4: `@carbon/auth/sso.server` — GoTrue admin wrappers + session helper

**Depends on:** Tasks 2, 3
**Files:**
- Create: `packages/auth/src/services/sso.server.ts`
- Modify: `packages/auth/package.json` — add `"./sso.server"` export subpath (mirror the existing `"./mfa.server"` entry exactly, including types/import/require shape)
- Copy from (precedent): `packages/auth/src/services/mfa.server.ts` (server-only service file shape), `packages/auth/src/lib/supabase/client.server.ts` (env constant imports)

**Steps:**
1. Implement, using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `@carbon/env` and plain `fetch` against GoTrue admin REST (`${SUPABASE_URL}/auth/v1/admin/sso/providers`), headers `{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" }`. All functions return `{ data, error }`, never throw:
   - `createGoTrueSsoProvider(args: { metadataUrl?: string; metadataXml?: string; domains: string[] })` → POST body `{ type: "saml", metadata_url?, metadata_xml?, domains }`; returns `{ data: { id: string }, error: null }` from the response's provider `id`.
   - `updateGoTrueSsoProvider(providerId: string, args: same)` → PUT `/admin/sso/providers/{id}`.
   - `deleteGoTrueSsoProvider(providerId: string)` → DELETE `/admin/sso/providers/{id}`.
   - `getGoTrueSsoProvider(providerId: string)` → GET `/admin/sso/providers/{id}`.
   - Non-2xx → `{ data: null, error: <message from body or statusText> }`.
2. `getSsoProviderIdFromUser(user: User): string | null` — read the SSO provider id from the Supabase user object. In GoTrue v2.x SAML users carry an identity with `provider` = `"sso:<providerId>"` in `user.identities`, and `user.app_metadata.provider` similarly prefixed. Implement: scan `user.identities ?? []` for a `provider` starting with `"sso:"`, return the suffix; fall back to `user.app_metadata?.provider?.startsWith("sso:")`. **If a locally-run SAML login (Task 14) shows neither location carries the provider id, STOP and report the actual user JSON — do not guess a third location.**

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth
# Expected: exit 0
```

**Out of scope:** no calls from client code (server-only file); no retry/backoff logic.

## Task 5: SSO connection validator + service functions (settings module)

**Depends on:** Tasks 2, 4
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — add `ssoConnectionValidator`
- Modify: `apps/erp/app/modules/settings/settings.server.ts` (create this file if it does not exist; check `apps/erp/app/modules/settings/` first and follow the module's existing server-file pattern if present)
- Modify: `apps/erp/app/modules/settings/index.ts` — barrel export if the module barrels server files (check first; if server files are not barreled, import routes directly from the file, matching how other `x+/settings+` routes import server helpers)
- Copy from (precedent): `apps/erp/app/modules/settings/settings.models.ts` `apiKeyValidator` (L55) for validator shape; `apps/erp/app/modules/settings/settings.service.ts` for `{ data, error }` service shape

**Steps:**
1. `ssoConnectionValidator` (zod, used with `validator(...)` from `@carbon/form`):
   - `metadataUrl`: `zfd.text(z.string().url().optional())`
   - `metadataXml`: `zfd.text(z.string().optional())`
   - `domains`: `zfd.text(z.string().min(1))` — comma-separated in the form; `.transform` split/trim/lowercase; `.refine` every entry matches `/^[a-z0-9.-]+\.[a-z]{2,}$/` and contains no `@`
   - `.refine` exactly one of `metadataUrl`/`metadataXml` present.
2. Service functions in `settings.server.ts` (service-role client first arg, return `{ data, error }`):
   - `getSsoConnection(client, companyId)` — `client.from("ssoConnection").select("*").eq("companyId", companyId).eq("active", true).maybeSingle()`
   - `getSsoConnectionByDomain(serviceRole, domain)` — `.contains("domains", [domain.toLowerCase()]).eq("active", true).maybeSingle()`
   - `getSsoConnectionByProviderId(serviceRole, providerId)` — `.eq("providerId", providerId).eq("active", true).maybeSingle()`
   - `upsertSsoConnection(serviceRole, { companyId, metadataUrl, metadataXml, domains, userId })`:
     a. For each domain call `getSsoConnectionByDomain`; if a hit belongs to a DIFFERENT company → return `{ data: null, error: "Domain <d> is already registered to another company" }`.
     b. Load existing connection for the company. If exists → `updateGoTrueSsoProvider(providerId, ...)` then update the row (`domains`, `metadataUrl`, `metadataXml`, `updatedBy: userId`, `updatedAt: now ISO`). If not → `createGoTrueSsoProvider(...)`, then insert the row (`companyId`, `providerId`, `domains`, `metadataUrl`, `metadataXml`, `createdBy: userId`); **on insert failure call `deleteGoTrueSsoProvider(providerId)` before returning the error** (compensating action — GoTrue is outside the DB transaction).
   - `deactivateSsoConnection(serviceRole, { companyId, userId })` — load connection; `deleteGoTrueSsoProvider(providerId)`; update row `active: false, updatedBy, updatedAt`.
3. Add the same `getSsoConnectionByDomain` to MES: `apps/mes/app/services/sso.service.ts` (MES layout keeps services flat; same function body).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit 0
```

**Out of scope:** no UI here; no callback logic; no Kysely (single-row writes).

## Task 6: `reassignUserReferences` + `migrateUserToSso` transaction (users module)

**Depends on:** Tasks 2, 5
**Files:**
- Create: `apps/erp/app/modules/users/users.sso.server.ts`
- Copy from (precedent): grep `transaction().execute(` under `apps/erp/app` and follow the existing Kysely-transaction import pattern from the first service hit (e.g. how the module obtains the Kysely client). **If no ERP service uses a Kysely transaction, STOP and report** — do not invent a new DB client path.

**Steps:**
1. `REASSIGNABLE_USER_COLUMNS: { table: string; column: string }[]` — exactly the list in "Design refinements" §4 above (31 `assignee` tables + the 12 named columns). Include a comment block stating the inclusion contract: mutable forward-looking user references, company-scoped tables only; audit actors (`createdBy`/`updatedBy`/`closedBy`/`postedBy`), `workflowRun.ownerId`, `companyGroup.ownerId` are excluded by policy; new assignee-type columns must be added here.
2. `reassignUserReferences(trx, { companyId, fromUserId, toUserId })` — for each entry: `UPDATE <table> SET <column> = toUserId WHERE <column> = fromUserId AND "companyId" = companyId`, via Kysely `trx.updateTable(...)`. Return per-table update counts for logging.
3. `migrateUserToSso(serviceRole, { newUserId, email, companyId, invite })` — orchestrates:
   a. Pre-checks OUTSIDE the transaction: load old user by email (`public."user"` where `email = <email> AND id <> newUserId AND active = true`, `.maybeSingle()`). If found, load its `userToCompany` rows; if any row has `companyId <> <companyId>` → return `{ data: null, error: "multi-company" }` (v1 limitation — caller flashes the support message).
   b. Kysely transaction:
      - Insert `public."user"` row for `newUserId` if absent (the trigger skipped it when the old row held the email): if an old user exists, FIRST update the old row `email = 'sso-archived+' || <oldId> || '+' || <email>`, `active = false`; THEN insert the new row (`id: newUserId`, `email`, `active: true`, `firstName`/`lastName` copied from the old row when present, else from the invite email local part, `about: ''`) with `ON CONFLICT (id) DO NOTHING` semantics (`onConflict` in Kysely: `.onConflict((oc) => oc.column("id").doNothing())`).
      - Accept the invite for `newUserId` — replicate `acceptInvite` internals transactionally (do NOT call `acceptInvite`, which uses supabase-client writes): `UPDATE "employee" SET "active" = true WHERE "id" = newUserId AND "companyId" = ...` is wrong for a NEW user — instead RE-KEY the invite-time rows (CONFIRMED via `.claude/rules/user-employee-job-relationships.md`: the invite flow pre-creates `employee` — PK `(id, companyId)`, `id → user.id` — keyed to an auth user created at invite time, i.e. the OLD id): `UPDATE "employee" SET "id" = newUserId, "active" = true WHERE "id" = oldId AND "companyId" = <companyId>` (the new `public."user"` row must be inserted FIRST for the FK), and the same re-key for `employeeJob` if rows exist (instead of deleting them — they carry title/department/manager placement worth keeping). For a fresh SSO user with an invite but NO old user (possible only if the invite-time auth account was already deleted), insert the `employee` row following `createEmployeeAccount` (apps/erp/app/modules/users/users.server.ts:376). Insert `userToCompany` (`userId: newUserId, companyId, role: invite.role`), merge `invite.permissions` into `userPermission` for `newUserId` (follow `setUserPermissions` semantics from `apps/erp/app/modules/users/users.server.ts`), and set `invite.acceptedAt = now()` guarded by `acceptedAt IS NULL` (row-lock via `FOR UPDATE` select first to make concurrent accepts idempotent).
      - If old user existed: `reassignUserReferences(trx, { companyId, fromUserId: oldId, toUserId: newUserId })`; delete old `userToCompany` row for this company; `UPDATE "employee" SET "active" = false WHERE "id" = oldId AND "companyId" = companyId`; delete old `employeeJob` rows (id + companyId); remove old group `membership` rows (mirror `deactivateEmployee` in `packages/auth/src/services/users.server.ts:199-295`).
   c. Post-commit (idempotent, failure-tolerant — log, don't throw): `redis.del(getPermissionCacheKey(oldId))` and `redis.del(getPermissionCacheKey(newUserId))`; delete the old auth user via `serviceRole.auth.admin.deleteUser(oldId)` (revokes its sessions and frees the auth-level email).
4. Export from the module barrel only if other `.server.ts` files are barreled (check `apps/erp/app/modules/users/index.ts`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** callback wiring (Task 7); no changes to `acceptInvite` itself; no reassignment of audit columns under any circumstance.

> *(Superseded: this whole reassignment/deactivation design was later replaced by link-instead-of-archive; `reassignUserReferences` and `REASSIGNABLE_USER_COLUMNS` no longer exist. See the spec Changelog.)*

## Task 7: Callback SSO branch (ERP + MES)

**Depends on:** Tasks 4, 5, 6
**Files:**
- Modify: `apps/erp/app/routes/_public+/callback.tsx` — SSO branch in the action (before the existing company-resolution logic, after `refreshAccessToken`)
- Modify: `apps/mes/app/routes/_public+/callback.tsx` — same branch; MES has no invite-accept flow, so on the invite path redirect to the ERP URL (`getAppUrl()`) with a flash instead of running the migration (SSO users onboard via ERP once, then use MES normally)
- Copy from (precedent): the existing action structure in each file (service-role usage, `destroyAuthSession`, flash + redirect patterns)

**Steps (ERP):**
1. After the session is obtained, get the Supabase user for the token (the action already has `userId` + service role; fetch the auth user via `serviceRole.auth.admin.getUserById(userId)`), then `providerId = getSsoProviderIdFromUser(user)`. If null → existing non-SSO path unchanged (byte-identical behavior).
2. SSO path:
   a. `getSsoConnectionByProviderId(serviceRole, providerId)`. Miss/inactive → `destroyAuthSession` with flash "SSO connection is not active. Contact your administrator."
   b. Domain check: `email.split("@")[1].toLowerCase()` ∈ `connection.domains`, else → cleanup + reject (step d's cleanup).
   c. Membership check: `userToCompany` row for (userId, connection.companyId)? → proceed to the normal session-minting path, but scope company resolution to `connection.companyId` (set the company cookie to it).
   d. No membership: load pending invite (`invite` where `email` = user email AND `companyId` = connection.companyId AND `acceptedAt IS NULL` AND `revokedAt IS NULL`). No invite → delete the orphan auth user IF it has zero `userToCompany` rows (`serviceRole.auth.admin.deleteUser(userId)`), `destroyAuthSession`, flash "SSO sign-in succeeded but no invite exists for {email}. Contact your administrator." With invite → `migrateUserToSso(...)`. On `error === "multi-company"` → flash "This account belongs to multiple companies and cannot be migrated automatically. Contact support." (do NOT delete the auth user in this case). On success → proceed to session minting with `companyId = connection.companyId`.
3. Session minting for the SSO path sets `mfaVerified: true` in the `AuthSession` unless `CONTROLLED_ENVIRONMENT` is true (import both from `@carbon/auth`; the TOTP park-and-challenge check is skipped on this branch when not controlled).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit 0
```

**Out of scope:** magic-link/OAuth/passkey callback behavior — every non-SSO session must take the exact existing code path; no changes to the callback's default-export component.

## Task 8: Login "Continue with SSO" (ERP + MES) + public domain-check API route

**Depends on:** Tasks 3, 5
**Files:**
- Create: `apps/erp/app/routes/api+/sso.check.ts`
- Modify: `apps/erp/app/routes/_public+/login.tsx` — loader boolean + button + handler
- Modify: `apps/mes/app/routes/_public+/login.tsx` — same
- Copy from (precedent): `apps/erp/app/routes/_public+/login.tsx:94-110` (IP rate limiting with `Ratelimit` from `@carbon/kv`), L388-417 (`onSignInWithGoogle`/`onSignInWithAzure` handler shape), L493-533 (gated button rendering)

**Steps:**
1. `api+/sso.check.ts` — public action (no `requirePermissions`): `assertIsPost`; IP rate limit `Ratelimit.slidingWindow(20, "1 h")` keyed `sso-check:{ip}`; body `{ email }`; extract domain; `getSsoConnectionByDomain(getCarbonServiceRole(), domain)`; return `data({ enabled: Boolean(connection) })` — boolean only, no connection details.
2. ERP login loader: `const hasSsoAuth = isAuthProviderEnabled("sso") && CarbonEdition === Edition.Enterprise;` (both already imported or importable from `@carbon/auth`). Return it with the existing booleans.
3. Button (rendered with the other provider buttons, same `Button` component + separator handling): label "Continue with SSO". Handler `onSignInWithSSO`: require the email field to be non-empty (inline form error "Enter your email first" if empty); POST to `path.to.api.ssoCheck` (add the path key — Task 9 step 4 covers `path.to`; add `ssoCheck` under the api section here if Task 9 hasn't run: `ssoCheck: \`${api}/sso/check\``); if `{ enabled: false }` → inline error "SSO is not configured for your email domain."; else `const { data, error } = await carbonClient.auth.signInWithSSO({ domain, options: { redirectTo: \`${window.location.origin}/callback\` } })` and on success `window.location.href = data.url`.
4. MES login: same loader boolean + button; the check endpoint is the ERP one — MES calls its own copy: create `apps/mes/app/routes/api+/sso.check.ts` with the same body using the MES service from Task 5 step 3 (MES routes/services are separate apps; do not cross-import ERP modules).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit 0
```

**Out of scope:** academy/starter login pages; no domain enumeration beyond the boolean; existing provider buttons untouched.

## Task 9: Settings → SSO screen + nav + paths

**Depends on:** Tasks 4, 5
**Files:**
- Create: `apps/erp/app/routes/x+/settings+/sso.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `sso: \`${x}/settings/sso\`` beside `security` (L1967) and `api.ssoCheck` if not added in Task 8
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — add the entry to the System group next to Security (L200-205)
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/sequences.$tableId.tsx` (loader/action/validator/flash/redirect shape), `apps/erp/app/routes/x+/settings+/accounting.tsx` (ValidatedForm layout with Card sections), `apps/erp/app/routes/x+/settings+/security.tsx` (permission pattern + CONTROLLED_ENVIRONMENT read)

**Steps:**
1. Loader: `requirePermissions(request, { view: "settings", role: "employee" })`; if `CarbonEdition !== Edition.Enterprise` → `throw redirect(path.to.settings)` (spec: route hidden outside Enterprise). Return `getSsoConnection(client, companyId)` plus the SP URLs: `acsUrl: \`${SUPABASE_URL}/auth/v1/sso/saml/acs\``, `metadataUrl: \`${SUPABASE_URL}/auth/v1/sso/saml/metadata\`` (import `SUPABASE_URL` from `@carbon/auth`).
2. Action: `assertIsPost`; `requirePermissions(request, { update: "settings" })`; branch on a `intent` form field:
   - `intent === "upsert"` → `validator(ssoConnectionValidator).validate(formData)` → `validationError` on error → `upsertSsoConnection(getCarbonServiceRole(), { ...parsed, companyId, userId })` → error: `data({}, await flash(request, error(...)))`; success: `throw redirect(path.to.sso, await flash(request, success("SSO connection saved")))`.
   - `intent === "deactivate"` → `deactivateSsoConnection(...)` with the same flash/redirect pattern.
3. Component: Card "Service provider details" with the two read-only URLs and copy buttons (grep `packages/react/src/` for an existing copy-button component — use `Copy` from `@carbon/react` if present; if no copy component exists, render the URLs in `<Input isReadOnly>` fields without a copy button — do not build a new component); Card "Identity provider" with the `ValidatedForm` (fields: `Input` name `metadataUrl`, `TextArea` name `metadataXml`, `Input` name `domains` comma-separated with helper text, `Submit`); when a connection exists show registered domains + active state + a deactivate button inside a confirm `Modal` (precedent: any settings delete modal, e.g. `api-keys.delete.$id.tsx`).
4. Nav entry in `useSettingsSubmodules.tsx` System group: `{ name: t\`Single Sign-On\`, to: path.to.sso, role: "employee", icon: <LuKeyRound /> }` (import `LuKeyRound` from `react-icons/lu`). Nav has no per-edition flag — the route's loader redirect handles non-Enterprise access; ALSO hide the entry by adding it to the component's existing gating only if an edition gate exists in `isRouteVisible` — it does not, so instead conditionally include the route object using `useFlags().isEnterprise` (hook at `apps/erp/app/hooks/useFlags.tsx:15`) inside the `useSettingsSubmodules` body.
5. *(Superseded: this card shipped, was renamed "Covered Users", and was later removed entirely.)* The "Users to re-invite" migration-aid list from the spec: render a third Card listing active company users whose email domain ∈ `domains` (loader: query `employees` view via existing people/employees service — grep `getEmployees` in `apps/erp/app/modules/people` or `users` and reuse; select email + name only) with a note "These users will be migrated on their first SSO sign-in. Re-invite them to enable SSO access." and a Link to the existing employees page (`path.to.employeeAccounts` or equivalent — confirm the key exists in path.ts; bulk re-invite itself is the existing resend-invite flow, not rebuilt here).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** no new bulk-invite machinery; no MES settings surface; no i18n catalog fill (handled by /translate at commit time).

## Task 10: MFA exemption for SSO sessions

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/routes/x+/_layout.tsx` + `apps/mes/app/routes/x+/_layout.tsx` — the `MfaEnrollmentRequired` blocking-screen condition
- Copy from (precedent): the existing `requireMfa` gate logic in those loaders (grep `MfaEnrollmentRequired` for exact locations)

**Steps:**
1. Task 7 already mints SSO sessions with `mfaVerified: true` (non-controlled), which satisfies `requireAuthSession`'s re-check — no session.server.ts change needed. Verify this by reading `requireAuthSession`'s MFA bounce condition in `packages/auth/src/services/session.server.ts`; if it re-derives from `userHasVerifiedTotpFactor` REGARDLESS of `mfaVerified`, STOP and report.
2. *(Superseded: the `!CONTROLLED_ENVIRONMENT` condition below was later removed — SSO sessions are exempt in every environment.)* The `requireMfa` company-enforcement blocking screen: where the shell loader computes the gate (grep `requireMfa` in both `_layout.tsx` files), exempt sessions whose auth user is SSO-sourced when `!CONTROLLED_ENVIRONMENT`: the loader has the auth session — carry an `isSso` boolean on the `AuthSession` (add optional field `ssoProviderId?: string` to the `AuthSession` type in `packages/auth/src/types.ts` or wherever `AuthSession` is defined — grep `mfaVerified` in `packages/auth/src` to find it — set in Task 7's minting, preserved by `refreshAuthSession` exactly like `mfaVerified` — grep `mfaVerified` in `session.server.ts` and mirror every propagation site). Gate becomes: `requireMfa && !mfaVerified-satisfying-enrollment && !(authSession.ssoProviderId && !CONTROLLED_ENVIRONMENT)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp --filter=mes
# Expected: exit 0
```

**Out of scope:** TOTP enrollment UI; `/mfa` routes; API-key/OAuth machine paths (never challenged today).

## Task 11: SSO-aware invite emails

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/routes/x+/users+/employees.new.tsx` (invite email block L124-144), `customers.new.tsx` (L89-95), `suppliers.new.tsx` (L89-95), `resend-invite.tsx` (L72-121)
- Modify: `packages/jobs/src/inngest/functions/tasks/user-admin.ts` (bulk resend, L100-114)
- Copy from (precedent): the existing `sendEmail(... InviteEmail({ inviteLink }))` blocks in those files

**Steps:**
1. Add a tiny helper in the ERP users module (`apps/erp/app/modules/users/users.server.ts`): `getInviteLink(serviceRole, email, code): Promise<string>` — if `getSsoConnectionByDomain` (import from the settings server file) hits an active connection for the email's domain, return `${getAppUrl()}/login?email=${encodeURIComponent(email)}` (login page prefill; the SSO callback consumes the pending invite — the code is not needed in the URL); else return the existing `${getAppUrl()}/invite/${code}`.
2. Replace the hardcoded `inviteLink` in the three route actions and `resend-invite.tsx` with the helper.
3. `user-admin.ts` (jobs package cannot import ERP modules): inline the same two-step lookup there using its existing service-role client — query `ssoConnection` `.contains("domains", [domain]).eq("active", true).maybeSingle()` directly, then pick the URL. Keep the existing link as the fallback.
4. Login page: read `?email=` from the URL and prefill the email field if not already supported (check `login.tsx` for an existing `redirectTo`/searchParams pattern; if prefill via `?email=` doesn't exist, add `defaultValue` from `searchParams.get("email")`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** `invite.$code.tsx` route behavior (still works for already-authenticated SSO users); InviteEmail template content.

## Task 12: GoTrue SAML config (dev + prod compose, .env.example)

**Depends on:** none
**Files:**
- Modify: `packages/dev/docker/docker-compose.dev.yml` — GoTrue service env (L79-113 region)
- Modify: `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml` — GoTrue service env (L252-292 region)
- Modify: `.env.example` and `contrib/deploying/simple-docker-caddy/.env.example` — document the new vars

**Steps:**
1. Both compose files, in the GoTrue service `environment` block:
   ```yaml
   GOTRUE_SAML_ENABLED: ${SAML_ENABLED:-false}
   GOTRUE_SAML_PRIVATE_KEY: ${SAML_PRIVATE_KEY:-}
   ```
2. `.env.example` entries:
   ```bash
   # Enterprise SAML SSO (Enterprise edition). Generate the key with:
   #   openssl genpkey -algorithm RSA -out /tmp/pk.pem -quiet && \
   #   openssl pkey -in /tmp/pk.pem -out /tmp/pk.der -outform DER -traditional && \
   #   base64 -i /tmp/pk.der   # (-w 0 on Linux)
   # The key MUST be base64-encoded PKCS#1 DER (the -traditional flag), min 2048-bit.
   SAML_ENABLED=false
   SAML_PRIVATE_KEY=
   ```
3. Check how the dev proxy / prod Caddy route `/auth/v1/*`: grep the Caddyfile in `contrib/deploying/simple-docker-caddy/` and the dev proxy config in `packages/dev/` for auth routing. If `/auth/v1/` is already proxied wholesale to GoTrue with no per-path auth plugin, no change is needed (note this in the task's completion evidence). If SSO paths are excluded or an auth gate exists on them, add explicit pass-through for `/auth/v1/sso/saml/acs` and `/auth/v1/sso/saml/metadata`. If the routing cannot be determined from the files, STOP and report what was found.

**Verify:**
```bash
grep -n "GOTRUE_SAML" packages/dev/docker/docker-compose.dev.yml contrib/deploying/simple-docker-caddy/docker-compose.prod.yml
# Expected: 2 lines per file (ENABLED + PRIVATE_KEY)
```

**Out of scope:** `config.toml` (local runtime is docker-compose; hosted parity is a doc comment only if a natural place exists); no MockSAML container in this task (Task 14 decides if needed).

## Task 13: Unit tests — migration transaction, domain enforcement, trigger behavior

**Depends on:** Tasks 6, 7
**Files:**
- Create: `apps/erp/app/modules/users/users.sso.server.test.ts` (vitest; follow the existing test setup — grep `*.test.ts` under `apps/erp/app` for the closest service-test precedent and mirror its mocking approach; if ERP has no service-level test precedent and tests live only in packages, put the pure-logic tests in `packages/auth` instead and note it)

**Steps:**
1. Test the pure decision logic (extract as pure functions in Task 6/7 code where needed so they are testable without a DB):
   - domain-enforcement: provider→connection mismatch rejected; email domain not in `domains` rejected; case-insensitivity.
   - multi-company detection: old user with membership in another company → `"multi-company"` error.
   - `REASSIGNABLE_USER_COLUMNS` contains no audit columns: assert none of `createdBy`, `updatedBy`, `closedBy`, `postedBy`, and not `workflowRun`/`companyGroup` tables.
   - archived-email format is deterministic and preserves the original email as a suffix.
2. If the codebase has a DB-backed test harness for Kysely (grep `harness` package usage in tests), add one transactional test: forced failure mid-transaction leaves invite unaccepted and old user untouched. If no such harness exists, skip DB-backed tests and note it — do not build a test DB harness in this task.

**Verify:**
```bash
pnpm --filter erp test -- users.sso
# Expected: all new tests pass (adjust the filter invocation to the app's vitest config if `--` filtering differs; expected output contains "passed")
```

**Out of scope:** e2e/browser tests (Task 14); testing GoTrue itself.

## Task 14: Full gates + browser verification

**Depends on:** all
**Files:** none (verification only)

**Steps:**
1. `pnpm exec turbo run typecheck --filter=@carbon/env --filter=@carbon/auth --filter=@carbon/jobs --filter=erp --filter=mes`
2. `pnpm run lint`
3. `pnpm --filter erp test` (scoped to changed areas if the suite is slow)
4. Browser verification via `/test` (with the user's permission, per repo policy): requires the dev stack with `SAML_ENABLED=true`, a generated dev key, and an IdP. Register mocksaml.com (public mock IdP, metadata at `https://mocksaml.com/api/saml/metadata`) via the new settings screen against a dev company + a test domain, then walk: settings screen save → login button → IdP → callback → invited-user attach. If mocksaml.com is unusable from the dev environment, STOP and report; adding a local MockSAML container is a follow-up decision, not improvised here.
5. Spec bookkeeping: check acceptance criteria in the spec, add changelog entry (including the three design refinements from this plan's header), and record the v1 multi-company limitation.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: exit 0 (final green)
```

**Out of scope:** committing — commits happen only via /check-and-commit on the user's explicit ask; moving the spec to implemented/ (needs deployment evidence).
