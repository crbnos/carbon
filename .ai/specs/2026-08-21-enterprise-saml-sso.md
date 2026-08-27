# Enterprise SAML SSO

> Status: draft
> Author: naveen + Claude
> Date: 2026-08-21
> Research: [.ai/research/sso.md](../research/sso.md)

## TLDR

Add enterprise SAML 2.0 SSO to Carbon using GoTrue's native SAML engine — no broker, no new session system. A company admin configures their IdP (Okta/Entra/etc.) on a new Settings → SSO screen; users on registered email domains sign in via a "Continue with SSO" button that flows through the existing `/callback` session machinery. Enterprise edition + **self-hosted Supabase only** (hosted supabase.com is not supported). Provisioning is invite-first for new users; an existing ACTIVE account's first SSO login LINKS the SAML identity onto that account (nothing archived, magic link keeps working). An inactive same-email holder has its email freed (archived form) before the invited user's row is inserted. SSO sessions skip Carbon TOTP unconditionally (the IdP owns MFA, including under `CONTROLLED_ENVIRONMENT`).

## Problem Statement

Enterprise customers require login through their corporate identity provider (Okta, Microsoft Entra, Google Workspace) for security policy, onboarding/offboarding, and compliance reasons. Carbon today offers magic link, Google/Azure OAuth (project-global, not per-tenant), and passkeys — there is no way for a customer to route their whole workforce through their own IdP. This blocks enterprise deals and forces per-user credential management that enterprise IT explicitly forbids.

Concretely: Acme Corp (self-hosted Enterprise) wants `*@acme.com` users to authenticate via their Okta, with access revocable centrally by their IT, and without Carbon-side passwords or second MFA prompts.

## Proposed Solution

Enable GoTrue's built-in SAML SP (`GOTRUE_SAML_ENABLED` + `GOTRUE_SAML_PRIVATE_KEY` — the same enable-the-primitive-then-wire-it pattern used for TOTP MFA). Carbon adds:

1. **`ssoConnection` table** — the app-side record mapping a GoTrue SSO provider to a `companyId`, with its registered email domains. This is the tenant router and the security anchor (GoTrue providers are project-global; this table makes them company-scoped).
2. **`@carbon/auth/sso.server`** — thin server-only wrappers over GoTrue's admin REST API (`/auth/v1/admin/sso/providers`) for provider create/update/delete, called with the service-role key. *(Superseded: the SSO core now lives at `@carbon/ee/sso.server` behind the enterprise flag — see Changelog 2026-08-26.)*
3. **Settings → SSO screen** (ERP, Enterprise-gated, `settings` permission) — admin enters IdP metadata URL/XML + domains; screen displays Carbon's ACS URL and SP metadata URL for the IdP side; registration + `ssoConnection` row written together.
4. **Login button** (ERP + MES) — gated by `isAuthProviderEnabled("sso")` && Enterprise edition; takes the entered email, calls `carbonClient.auth.signInWithSSO({ domain })`, redirects to the returned IdP URL.
5. **Callback SSO branch** — the existing `/callback` action detects an SSO session (JWT `sso_provider_id` claim) and enforces the provisioning policy + migration transaction (below) before minting the `carbon` cookie. Non-SSO logins are untouched.
6. **First-SSO-login migration** — one Kysely transaction: accept pending invite (attach + permissions). *(Superseded: the original re-point-references-and-deactivate design was replaced by **link-instead-of-archive** — an ACTIVE same-email account gets the SAML identity linked onto it and nothing is deactivated; only an INACTIVE holder's email is freed via `buildArchivedEmail`. See Changelog 2026-08-21 "Link-instead-of-archive".)*

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SSO mechanism | Native GoTrue SAML (`signInWithSSO`), not WorkOS/Polis/OIDC brokers | One session system (cookie/MFA/claims untouched); works self-hosted with the `supabase/gotrue:v2.189.0` image already deployed; brokers add a second service or replace GoTrue sessions (research §4) |
| Deployment target | Self-hosted ONLY (final — hosted supabase.com support was added, then removed by user decision) | User decision. Provider registration via GoTrue admin REST with existing service-role key — no Supabase plan/Management API dependency. Linking requires direct `auth.identities` writes, which hosted forbids |
| Edition gating | Enterprise only (`CarbonEdition === Edition.Enterprise` gates button + settings screen) | User decision. Aligns with self-hosted; matches Enterprise's existing reject-unknown-users posture |
| Provisioning | Invite-first; JIT deferred | User decision. Reuses `acceptInvite` machinery, closes the JIT bypass of Enterprise's unknown-user rejection, avoids designing default permissions. JIT + IdP group→role mapping is a future per-company toggle |
| Existing users | LINKED, never archived (final — supersedes the re-invite/archival contract) | User decision. The callback moves the SAML identity onto the existing ACTIVE account (`linkSsoIdentityToUser`, direct `auth.identities` UPDATE — safe because SSO is self-hosted-only) after the domain check. Same account, same id — no reassignment, no archival, magic link keeps working |
| First-login migration | Invite-accept transaction only: insert user row → activate the invite's account row (`employee` / `customerAccount` / `supplierAccount`, keyed by `invite.role`) → membership → merge permissions → accept invite | The archival machinery (reassign references, strip permissions, delete old auth user) was deleted with hosted support — linking makes it dead code. An INACTIVE same-email holder gets its email rewritten to the archived form (`buildArchivedEmail`) inside the transaction to free the unique email index; an ACTIVE holder is a defensive refusal (linking should have absorbed it) |
| MFA policy | SSO sessions mint `mfaVerified: true` (skip Carbon TOTP) unconditionally — including `CONTROLLED_ENVIRONMENT=true` | User decision. The IdP owns MFA (usually stronger than TOTP); double-challenging is friction theater. In controlled environments, MFA attestation is delegated to the IdP policy (superseding the earlier forced-TOTP exception) |
| Admin UX | In-app Settings → SSO screen | User decision. Feasible because self-hosted = GoTrue admin REST + service-role key server-side; no CLI/operator step per customer |
| Tenant routing / security anchor | `ssoConnection` table (providerId UNIQUE, companyId, domains[]) + callback enforcement | GoTrue providers are project-global; domains route the login but nothing natively binds a provider to a company. Callback MUST verify: session's `sso_provider_id` → `ssoConnection` → its `companyId` is the company being attached, AND the asserted email's domain ∈ connection domains. Closes the rogue-IdP asserted-email attack (research challenge #3) regardless of GoTrue's own behavior |
| Where SSO settings code lives | `settings` module (`settings.service.ts`/`settings.server.ts`) + `@carbon/auth/sso.server` for GoTrue calls | Lesson: "Features live inside existing permission modules." Screen gates on existing `settings_view`/`settings_update` — no new permission module |
| Orphan auth users | SSO login with no invite and no membership → sign out, flash "Contact your administrator", delete the JIT-created auth user (admin API) | Enterprise posture: no self-serve. Deleting the orphan keeps `auth.users` clean and makes retries idempotent |
| Reassignment mechanism | `reassignUserReferences(trx, { companyId, fromUserId, toUserId })` driven by an explicit maintained list of `{table, column}` pairs (assignee-type columns only) | Explicit list over information_schema magic: auditable, excludes audit columns by construction. Enumerated during planning via a schema sweep |
| Invite email for SSO domains | Invite creation/acceptance detects an active `ssoConnection` domain match and routes the recipient to the login page (SSO path) instead of generating a magic link | Follows from invite-first: a magic link for an SSO-managed domain would bypass the IdP on day one |
| Multi-tenancy (heuristic 1) | `ssoConnection`: `companyId`, composite PK `("id","companyId")`, `id('sso')` default, audit columns | Convention |
| Service shape (heuristic 2) | All new service fns take `client` first, return `{ data, error }` | Convention |
| RLS (heuristic 3) | Standard SELECT/INSERT/UPDATE/DELETE policies on `ssoConnection`; writes require `settings_update` scope | Convention (`conventions-database.md`) |
| Permissions (heuristic 4) | Screen: `view: "settings"` / `update: "settings"` (mirrors `x+/settings+/security.tsx`); callback runs pre-session via service role like today | Convention |
| Forms (heuristic 5) | `ValidatedForm` + zod validator in `settings.models.ts` + route action | Convention |
| Module layout (heuristic 6) | No new module; settings module + `@carbon/auth` subpath export | Convention + lesson |
| Backward compatibility (heuristic 7) | Login/callback changes are purely additive branches; non-SSO flows byte-identical. New env vars optional (SAML off by default everywhere) | Preserve behavior |

## Data Model Changes

One new table + no changes to existing tables.

```sql
-- pnpm db:migrate:new sso-connection  (never backdate the timestamp — lesson)
CREATE TABLE "ssoConnection" (
    "id" TEXT NOT NULL DEFAULT id('sso'),
    "companyId" TEXT NOT NULL,
    -- GoTrue linkage
    "providerId" TEXT NOT NULL,            -- auth.sso_providers uuid; UNIQUE project-wide
    "domains" TEXT[] NOT NULL,             -- registered email domains (written atomically with GoTrue registration)
    "metadataUrl" TEXT,                    -- one of metadataUrl/metadataXml set (IdP metadata is public, not secret)
    "metadataXml" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "requireSso" BOOLEAN NOT NULL DEFAULT FALSE,  -- per-connection enforcement toggle (Changelog 2026-08-21)
    -- Audit
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "ssoConnection_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ssoConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ssoConnection_providerId_key" UNIQUE ("providerId")
);
CREATE INDEX "ssoConnection_companyId_idx" ON "ssoConnection" ("companyId");

ALTER TABLE "ssoConnection" ENABLE ROW LEVEL SECURITY;
-- Standard policy names per conventions-database.md:
-- SELECT: any employee of the company; INSERT/UPDATE/DELETE: settings_update permission.
```

Notes:
- GoTrue's `auth.sso_providers` / `auth.sso_domains` remain the runtime source of truth for the SAML handshake; `ssoConnection` is the app-side company binding + display record. The settings action writes both in one flow (GoTrue admin call first, DB row second; on DB failure the GoTrue provider is deleted — compensating action, since GoTrue is outside the Kysely transaction).
- Domain lookup for the login button uses `ssoConnection.domains` (service role, pre-auth) — one domain may appear in at most one active connection (enforced in the service, since Postgres can't UNIQUE across array elements cheaply; GoTrue also rejects duplicate domains project-wide).
- No `companySettings` column needed: MFA-trust is code policy, not per-company data, in v1.
- After migration: `pnpm run generate:types` before typecheck; remember PostgREST schema reload applies to migrations adding RPCs (none here).

## API / Service Changes

**`packages/auth/src/services/sso.server.ts`** (new, exported as `@carbon/auth/sso.server`) — GoTrue admin REST wrappers using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`:
- `createGoTrueSsoProvider({ metadataUrl?, metadataXml?, domains })` → `{ data: { id }, error }`
- `updateGoTrueSsoProvider(providerId, { metadataUrl?, metadataXml?, domains })`
- `deleteGoTrueSsoProvider(providerId)`
- `getSsoProviderIdFromSession(accessToken, user)` — decodes the session's own access token and requires an `amr` entry with `method: "sso/saml"` before resolving the provider id from the identity list; fails CLOSED to the non-SSO path on an undecodable token or missing `amr`. *(The original user-identities-only contract was a misclassification bug — see Changelog 2026-08-21 "security fix, session classification". Lives in `@carbon/ee/sso.server` `session.server.ts`.)*

**`apps/erp/app/modules/settings/settings.service.ts` / `settings.server.ts`:**
- `getSsoConnection(client, companyId)` — the company's connection (0 or 1 in v1 UI; table supports N)
- `getSsoConnectionByDomain(serviceRole, domain)` — pre-auth login lookup (also used by MES via shared query or duplicated MES service per its lighter layout)
- `getSsoConnectionByProviderId(serviceRole, providerId)` — callback enforcement
- `upsertSsoConnection(serviceRole, { companyId, metadataUrl?, metadataXml?, domains, userId })` — validates domains unclaimed → GoTrue create/update → row write; compensating delete on failure
- `deactivateSsoConnection(serviceRole, { companyId, userId })` — GoTrue delete + `active = false`

**`packages/auth`:**
- `packages/env/src/index.ts` — `AuthProvider` union gains `"sso"`; `AUTH_PROVIDERS` docs updated.
- `session.server.ts` — no structural change; SSO callback path mints `AuthSession` with `mfaVerified: true` unconditionally, which the existing `requireAuthSession` re-check already honors.
- MFA blocking screen (`MfaEnrollmentRequired` in shell loaders): exempt sessions whose auth user is SSO-sourced in all environments, including `CONTROLLED_ENVIRONMENT` (IdP owns MFA; a `requireMfa` company would otherwise force TOTP enrollment on SSO users).

**Callback (`apps/erp/app/routes/_public+/callback.tsx` action + MES mirror)** — new SSO branch when the session carries `sso_provider_id`:
1. Resolve `ssoConnection` by `providerId` (service role). Missing/inactive → destroy session, flash error.
2. Enforce `email.domain ∈ connection.domains`. Fail → destroy session + delete orphan auth user (if membershipless), flash error.
3. Existing `userToCompany` for (user, connection.companyId) → proceed as today (repeat login).
4. Else pending un-accepted `invite` matching email + `connection.companyId` → run the migration transaction (below) → proceed.
5. Else → destroy session, delete the JIT-created membershipless auth user, flash "SSO sign-in succeeded but no invite exists for {email}. Contact your administrator."

**Migration transaction** — `migrateUserToSso(trx, ...)`, called from callback step 4, single Kysely transaction. *(Steps 2a/2b below are superseded: linking runs FIRST for an active same-email holder, so reassignment/deactivation never happens; an inactive holder only has its email freed via `buildArchivedEmail`. Kept for history — see Changelog 2026-08-21 "Link-instead-of-archive". The code now lives in `@carbon/ee/sso.server` `provisioning.server.ts`.)*
1. Accept the invite for the NEW auth user (reuse `acceptInvite` internals: activate + `addUserToCompany` + `setUserPermissions` + mark accepted).
2. Find old ACTIVE user with same email attached to the same company, different id. If found:
   a. `reassignUserReferences(trx, { companyId, fromUserId: old, toUserId: new })` — explicit `{table, column}` list of assignee-type columns (enumerated at plan time). Audit columns (`createdBy`, `updatedBy`, ledger/audit tables) are excluded by policy.
   b. Deactivate old user (existing deactivate flow semantics: `active = false`, remove `userToCompany` for this company, invalidate permission cache `redis.del(getPermissionCacheKey(oldUserId))`, revoke sessions via admin sign-out).
3. Post-transaction: invalidate new user's permission cache.

**Invite flow** — `acceptInvite` / invite email generation: when the invitee's domain matches an active `ssoConnection`, the invite email links to the login page (`?email=` prefilled) instead of a magic link, and the invite is consumed by the SSO callback path rather than `invite.$code` magic-link redemption (the `invite.$code` route still works if the user is already SSO-authenticated).

**Config (no code):**
- `packages/dev/docker/docker-compose.dev.yml` + `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml`: `GOTRUE_SAML_ENABLED: ${SAML_ENABLED:-false}`, `GOTRUE_SAML_PRIVATE_KEY: ${SAML_PRIVATE_KEY:-}` (base64 PKCS#1 DER; generation command documented in `.env.example`). Verify/route `/auth/v1/sso/saml/{metadata,acs}` publicly through the dev proxy and prod Caddy.
- `packages/database/supabase/config.toml`: hosted-parity comment (no `[auth.saml]` block exists in config.toml format for local; runtime is docker-compose).
- Dev: optional MockSAML container or mocksaml.com for e2e testing.

## UI Changes

**Settings → SSO (`apps/erp/app/routes/x+/settings+/sso.tsx`, new):**
- Gated: `view: "settings"` (loader) / `update: "settings"` (action); rendered only when `CarbonEdition === Edition.Enterprise` (route returns 404/redirect otherwise); nav entry beside Security.
- Read panel: Carbon's SP details to copy — ACS URL (`{SUPABASE_URL}/auth/v1/sso/saml/acs`) and SP metadata URL — with copy buttons.
- Form (`ValidatedForm` + `ssoConnectionValidator` in `settings.models.ts`): metadata URL **or** XML upload (exactly one), domains (tag input, lowercase, no `@`), active toggle. Zod refines: valid domains, at least one, URL xor XML.
- Status: connection active/inactive, registered domains, last updated; deactivate button (confirm dialog).
- Migration aid: "Users to re-invite" list — active company users whose email domain is in `domains` and whose auth identity is not SSO — with a bulk re-invite action (reuses existing invite creation).

**Login (ERP `_public+/login.tsx` + MES mirror):**
- "Continue with SSO" button rendered when `isAuthProviderEnabled("sso")` && Enterprise (loader booleans, same pattern as `hasGoogleAuth`).
- Click: validates entered email present → server resolves domain → `signInWithSSO` — implemented as the existing client-side pattern: fetch provider existence via a tiny public API route (`api+/sso.check.ts`, rate-limited, returns only boolean to avoid domain enumeration beyond what the button UX requires), then `carbonClient.auth.signInWithSSO({ domain, options: { redirectTo: /callback } })` and `window.location = data.url`. Unknown domain → inline "SSO is not configured for your email domain."

**No UI changes** to: `/callback` component, `/mfa`, academy/starter apps (out of scope — their logins are hardcoded and non-Enterprise).

## Acceptance Criteria

- [ ] With `AUTH_PROVIDERS=...,sso` and Enterprise edition, the ERP and MES login pages show "Continue with SSO"; with either condition false, the button is absent and all existing login methods behave byte-identically.
- [ ] Admin with `settings_update` registers an IdP via Settings → SSO using a metadata URL and domain `acme.com`; the screen then shows the ACS + SP metadata URLs and the active connection; a `ssoConnection` row and a GoTrue provider exist; registering `acme.com` under a second company fails with a clear error.
- [ ] A user with a pending invite for `jane@acme.com` completes IdP login and lands authenticated in the correct company with exactly the invite's permissions; the invite is marked accepted.
- [ ] First SSO login of a pre-existing `jane@acme.com`: the SAML identity is linked onto her EXISTING account, nothing is deactivated, magic link keeps working, and both login methods hit one account. *(Original criterion — reassign references + deactivate old account — superseded by link-instead-of-archive; see Changelog 2026-08-21.)*
- [ ] SSO login with no invite and no membership is rejected with "contact your administrator", no `userToCompany` row exists afterward, and the orphan auth user is removed; retrying after an invite is created succeeds.
- [ ] A SAML assertion whose email domain is NOT in the provider's registered `ssoConnection.domains` is rejected at callback even when a matching invite exists in another company.
- [ ] SSO session skips the TOTP challenge and the `requireMfa` blocking screen in every environment, including `CONTROLLED_ENVIRONMENT=true` (magic-link users are still challenged/gated).
- [ ] Inviting `bob@acme.com` (SSO-managed domain) sends an invite email that routes to the SSO login, not a magic link.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp --filter=mes`, `pnpm run lint`, and unit tests for the callback SSO branch + migration transaction + domain enforcement pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Rogue/misconfigured customer IdP asserts an email at another company's domain | High | Callback enforces `providerId → ssoConnection → companyId` binding AND email-domain ∈ registered domains, independent of GoTrue behavior; invites only match within the connection's company |
| Migration transaction partially applied (reassign done, deactivate failed) | High | Single Kysely transaction; GoTrue admin sign-out + cache invalidation are post-commit and idempotent-retryable |
| Duplicate-email collision between old `public.user` row and trigger-created new row | Med | `create_public_user` uses `ON CONFLICT (id)`; verify `user.email` unique constraint behavior in implementation — if unique, the trigger insert for the new auth user must tolerate the old row until deactivation renames/frees it; covered by a dedicated test before shipping |
| GoTrue admin API contract drift across image upgrades | Med | Wrappers isolated in one file; pin `supabase/gotrue` image version bumps to a checklist item that re-runs SSO e2e |
| ACS/metadata endpoints not reachable through prod Caddy | Med | Explicit deployment task + smoke check (`curl` SP metadata) in the rollout checklist |
| `GOTRUE_SAML_PRIVATE_KEY` mismanagement (wrong format, leaked) | Med | PKCS#1 generation command documented; stored as Swarm secret in prod compose; never in git |
| Reassignment list drifts as new assignable columns are added | Low | List lives beside the migration fn with a comment contract; conformance note in users module AGENTS.md |
| Domain enumeration via the public SSO-check endpoint | Low | Rate-limited, boolean-only response; equivalent information is already discoverable by attempting SSO login |

## Open Questions

> All resolved with the user (conversational interview, 2026-08-21) before this spec was written; recorded here as the audit trail.

- [x] Microsoft-tenant-only vs full SAML? — **Answer:** Full SAML, coexisting with the existing Google/Azure/magic-link/passkey methods; SSO activates per registered domain.
- [x] Hosted or self-hosted first? — **Answer:** Self-hosted (GoTrue admin REST + service-role key; no Supabase plan dependency).
- [x] Invite-first or JIT? — **Answer:** Invite-first for v1; JIT (with IdP group→role mapping) deferred as a future per-company toggle.
- [x] Migration promise for existing users? — **Answer:** Re-invite contract; on first SSO login one atomic transaction attaches the new account, auto-re-points assignable references, and deactivates the old account; immutable audit history deliberately stays on the deactivated account. No id-remap in v1. *(Superseded by later user decision: link-instead-of-archive — the existing active account is linked, nothing is deactivated, and existing members need no re-invite — see Changelog.)*
- [x] Edition gating? — **Answer:** Enterprise-only.
- [x] MFA for SSO users? — **Answer:** Trust the IdP (skip Carbon TOTP + requireMfa screen), except `CONTROLLED_ENVIRONMENT=true` where forced TOTP remains. *(Superseded by later user decision: the controlled-environment exception is removed; the IdP is trusted unconditionally — see Changelog.)*
- [x] Admin UX? — **Answer:** In-app Settings → SSO screen (self-serve), enabled by the self-hosted admin-API path.
- [x] SSO-only domain enforcement (block magic link/OAuth/passkey for managed domains)? — **Answer:** Out of scope for v1 (documented deferral; recommended as a later per-company toggle once migration tooling is proven). Magic link and SSO coexist during the migration window by design. *(Superseded by later user decision: shipped as the per-connection `requireSso` toggle — see Changelog.)*
- [x] SCIM / automatic offboarding? — **Answer:** Out of scope for v1; manual deactivation via existing flows; broker (Ory Polis/SSOReady) is the later path if demanded.

Build-time verifications (not design questions): exact JWT/user-object location of `sso_provider_id` in GoTrue v2.189.0; `public.user` email uniqueness behavior during migration overlap; dev/prod proxy routing for `/auth/v1/sso/saml/*`; assignable-column enumeration (plan task).

## Changelog

- 2026-08-21: Created. All open questions pre-resolved via user interview (see Open Questions). Research at `.ai/research/sso.md`.
- 2026-08-21 (implementation): Kong route `auth-v1-sso` added (`/sso/` → gotrue) — GoTrue self-declares its SP entityID/ACS from `API_EXTERNAL_URL` WITHOUT the `/auth/v1` prefix and validates each assertion's `Destination` against that exact URL, so the un-prefixed path is the canonical one given to IdPs and shown on the settings screen. Reassignment list corrected to 39 live columns (4 spec-era columns no longer exist; compile-time-checked via `satisfies`). Fresh-invited-user-without-any-old-account edge (invite-time auth account hard-deleted) fails closed with a "re-invite" error rather than guessing an employeeType. MES first SSO login defers to ERP (owns the invite migration).
- 2026-08-21 (planning): Three design refinements forced by the schema sweep, surfaced for user review in `.ai/plans/2026-08-21-enterprise-saml-sso.md` ("Design refinements" section): (1) `create_public_user()` updated to skip — never mutate — on a duplicate email owned by a different id, since the global `index_user_email_key` would otherwise crash the trigger inside GoTrue's transaction and fail the SAML login opaquely; the callback migration transaction owns creating the new row post-verification. (2) v1 LIMITATION: an old same-email account with memberships in OTHER companies blocks SSO migration with a "contact support" error (archiving it would break its other-company logins). (3) Old-account archival = `active=false` + email rewritten to `sso-archived+{oldId}+{email}` inside the transaction, old auth user deleted post-commit; invite-time `employee`/`employeeJob` rows are RE-KEYED to the new user id (the invite flow pre-creates them under an invite-time auth id).

- 2026-08-21 (hosted supabase.com support): Hosted prod is now supported alongside self-hosted, branched on `IS_HOSTED_SUPABASE` (`Boolean(SUPABASE_PROJECT_REF)`, `@carbon/env`; hosted also requires `SUPABASE_ACCESS_TOKEN` — provider CRUD returns a clear error when it is missing). Three differences on hosted: (1) provider registration goes through the Supabase Management API (`https://api.supabase.com/v1/projects/{ref}/config/auth/sso/providers`, Bearer personal access token, same `{ type: "saml", metadata_url?, metadata_xml?, domains }` body) instead of the GoTrue admin API — one shared `ssoProviderRequest` in `packages/auth/src/services/sso.server.ts` picks the backend; (2) SP URLs carry the `/auth/v1` prefix — `getSamlSpUrls()` owns the branch (self-hosted stays un-prefixed per the Kong `auth-v1-sso` route) and the settings screen uses it; (3) the link-instead-of-archive branch in `callback.tsx` is SKIPPED — hosted restricts direct `auth.identities` writes, so an existing account's first SSO login falls through to the invite + `migrateUserToSso` archival path, which is the hosted contract. Self-hosted behavior is unchanged (GoTrue admin API, un-prefixed SP URLs, linking).
- 2026-08-21 (user decision, final): **Hosted supabase.com support removed.** SSO is self-hosted-only — the Management API branch in `ssoProviderRequest`, the `/auth/v1`-prefixed SP URLs, and the `IS_HOSTED_SUPABASE` / `SUPABASE_PROJECT_REF` / `SUPABASE_ACCESS_TOKEN` env exports are all deleted. With linking now unconditional, the archival machinery in `migrateUserToSso` (`shouldBlockMultiCompany`, `removeCompanyFromPermissions`, `reassignUserReferences`, `REASSIGNABLE_USER_COLUMNS`, the `if (oldUser)` archive/re-key/cleanup branch, the "multi-company" error) was dead code and is deleted. Two audited bugs fixed: (1) an INACTIVE same-email holder no longer causes a permanent unique-violation failure — `migrateUserToSso` now looks up the email active-agnostically, refuses defensively when the holder is active (linking should have absorbed it; retry sign-in), and frees an inactive holder's email via `buildArchivedEmail` inside the transaction before the fresh insert; (2) the misleading "Users to Re-invite" card is now "Covered Users" with copy stating the linking truth — existing members sign in with SSO automatically on their next login, no re-invite needed; only not-yet-members need an invite (invite emails for covered domains route to SSO automatically).
- 2026-08-21 (user decision): Controlled-environment TOTP exception removed for SSO sessions — SSO logins now mint `mfaVerified: true` and skip the `requireMfa` gate unconditionally, including `CONTROLLED_ENVIRONMENT=true`; MFA attestation is delegated to the IdP policy.
- 2026-08-21 (requireSso toggle): **Per-connection SSO enforcement shipped**, superseding the v1 "SSO-only enforcement out of scope" deferral. `ssoConnection.requireSso` (BOOLEAN NOT NULL DEFAULT FALSE, migration `20260821111133_sso-require-toggle.sql`); toggled from the Connection Status card on Settings → Security via a `requireSso` intent on the `x+/settings+/sso.tsx` action (`updateSsoRequireSso` in `settings.server.ts`). When true, `isSsoRequiredForEmail` (ERP `settings.server.ts`, MES `sso.service.ts`) is enforced SERVER-SIDE at every non-SSO mint point in both apps: the login action (magic link + verification-code path; the `DEV_BYPASS_EMAIL` branch is deliberately exempt so local dev keeps working), the callback's non-SSO branch (catches Google/Azure OAuth and magic links minted elsewhere), and the passkey verify route (403 before `signInWithPasskey`). `api+/sso.check.ts` now returns `{ enabled, required }`; login pages rely on the server refusals surfacing through their existing inline error mechanisms (no client-side hiding). Bootstrap is inherent — the toggle exists only on an ACTIVE connection, so setup → verified sign-in → enforce is the only possible order. Break-glass for operators is documented in `docs/content/docs/platform/single-sign-on.mdx`: `UPDATE "ssoConnection" SET "requireSso" = false WHERE "companyId" = '<id>';`.
- 2026-08-21 (security fix, session classification): The callbacks classified a login as SSO by scanning the auth user's IDENTITIES (`getSsoProviderIdFromUser`) — but after link-instead-of-archive, a linked account carries a permanent `sso:` identity, so every subsequent Google/magic-link login was misclassified as an SSO session: it bypassed the Require SSO enforcement on the non-SSO path AND was minted `mfaVerified: true` (TOTP silently skipped). Fixed by deriving SSO-ness from the session's own JWT: new `getSsoProviderIdFromSession(accessToken, user)` in `packages/auth/src/services/sso.server.ts` decodes the access token (unverified — it was just minted for us by GoTrue) and requires an `amr` entry with `method: "sso/saml"` before resolving the provider id from the identity list; undecodable token or missing `amr` fails CLOSED to the non-SSO path. Both ERP and MES `callback.tsx` now call it; `getSsoProviderIdFromUser` remains exported but is documented as answering "has an SSO identity", not "is an SSO session".
- 2026-08-21 (user decision, supersedes archival): **Link-instead-of-archive.** When an ACTIVE account already owns the asserted email, the callback moves the SAML identity onto it (`linkSsoIdentityToUser` — direct `auth.identities` UPDATE, self-hosted only), deletes the duplicate auth user GoTrue created, and mints a session for the existing account via server-side magic-link redemption (`admin.generateLink` + `verifyOtp`, token never leaves the request). Nothing is deactivated; magic link keeps working; both login methods hit ONE account. Existing members need NO invite (they're already authorized); invites remain required for genuinely new users. The archival/reassignment path in `migrateUserToSso` is now dead code for same-email cases (kept; linking runs first). Multi-company block is moot for linked users (nothing destroyed). Orphan-delete guards ensure a linked real account is never deleted. Security basis: linking only happens after the domain check binds the assertion to the connection's registered domains — this is the account-takeover surface Supabase's no-linking rule guards against, accepted deliberately for registered domains.
- 2026-08-21 (self-review fixes): (1) **Role-agnostic invite activation** (user decision: "when SSO is enabled everything should login via SSO") — `migrateUserToSso` now activates the invite-time account row for ALL invite roles (`employee` / `customerAccount` / `supplierAccount`), not just employees; previously a covered-domain customer/supplier invite was consumed (membership + permissions + `acceptedAt`) while its portal account row stayed inactive, unrecoverable without delete-and-reinvite. A missing row still refuses with a "re-invite" error inside the transaction (invite is NOT consumed) — `customerId`/`supplierId`/`employeeTypeId` are NOT NULL and the invite doesn't carry them. (2) **Stale-identity cleanup in linking** — `linkSsoIdentityToUser` now deletes any pre-existing `sso:%` identity on the target (in the same transaction as the move); after a deactivate → re-create connection cycle the old identity pointed at a dead provider, and `getSsoProviderIdFromUser` (first-match) could resolve it and permanently lock the account out with "SSO connection is not active". (3) **Cleanups**: the `ssoConnection` domain/provider lookups (`getSsoConnectionByDomain` / `ByProviderId`, `isSsoRequiredForEmail`) and the SSO-aware invite link (`getSsoAwareInviteLink`) were consolidated into `@carbon/auth/sso.server` — previously triplicated across ERP `settings.server.ts`, MES `sso.service.ts` (deleted), and an inline copy in jobs `user-admin.ts`; `upsertSsoConnection`'s domain-steal check is one `.overlaps` query instead of a per-domain loop; the action-only `x+/settings+/sso.tsx` gained a loader redirecting GETs to Security; the Covered Users card queries the `employees` view by domain suffix (no 500-row cap). (4) **Deactivation ordering** — `deactivateSsoConnection` flips the `ssoConnection` row inactive BEFORE deleting the GoTrue provider, and restores it if the provider delete fails; the old order (provider first) could strand a company with SAML dead while `requireSso` still refused every other login method, recoverable only by manual SQL.
- 2026-08-26 (review hardening): (1) **Migrations squashed** — the three SSO migrations (`sso-connection`, `sso-trigger-skip-permission-row`, `sso-require-toggle`) are now one `20260820215433_sso-connection.sql` carrying the final table (with `requireSso`) and the final skip-branch `create_public_user()`; `crbn migrate`'s stale-version auto-repair reconciles DBs that applied the pre-squash files. (2) **One active connection per company enforced in the DB** — partial unique index `ssoConnection_companyId_active_key` (`"companyId" WHERE "active"`), in the squashed migration for fresh DBs and in `20260825185617_sso-connection-active-unique.sql` (IF NOT EXISTS) for pre-squash DBs; closes the concurrent-upsert race that could leave two active rows and break every `.maybeSingle()` read. (3) **Wildcard-safe invite lookup** — the ERP callback escapes LIKE metacharacters in the asserted email before its case-insensitive `ilike` invite match, so `%`/`_` in an address can never match another invite.
- 2026-08-27 (domain verification, user decision): **Domains now require DNS TXT ownership proof** — the `domains TEXT[]` column and the app-side `.overlaps` steal check are replaced by the `ssoDomain` table (pending → verified lifecycle, global DB UNIQUE, only verified domains reach GoTrue). Designed and tracked in the follow-on spec `.ai/specs/2026-08-27-sso-domain-verification.md`; the `20260820215433` migration was edited in place (branch unmerged).
- 2026-08-26 (EE packaging, user decision): **SSO core moved to `@carbon/ee/sso.server`** (`packages/ee/src/sso/`) behind the enterprise flag. `isSsoEnabled()` (`gate.ts` — `CarbonEdition === Edition.Enterprise && isAuthProviderEnabled("sso")`) is the single flag: the connection lookups and admin mutations SELF-GATE on it (answer "no connection" / refuse without querying), and every route entry point checks it — login buttons (ERP + MES), both `sso.check` endpoints, the `x+/settings+/sso.tsx` action (closing the previously ungated mutation surface), the Security screen (loader-provided `ssoEnabled` replaces the client-side `isEnterprise` gate), and both callbacks' SSO branch (which now also skips the `admin.getUserById` call outside Enterprise). Module layout: `provider.server.ts` (GoTrue admin wrappers + `getSamlSpUrls`), `connections.server.ts` (lookups, `isSsoRequiredForEmail`, `getSsoAwareInviteLink`, upsert/requireSso/deactivate), `session.server.ts` (amr classification), `provisioning.server.ts` (linking + invite migration, now taking a `Kysely<KyselyDatabase>` parameter — the ERP callback passes its own `getDatabaseClient()`). `@carbon/auth` keeps only `AuthSession.ssoProviderId` + refresh preservation; its `./sso.server` subpath and ERP's `users.sso.server.ts` / `settings.server.ts` SSO section are deleted. Tests moved with the code (ee: 35, including a gate-off suite).
