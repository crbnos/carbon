# Enterprise SSO for Carbon — Research Findings

Date: 2026-08-21. Researched: current Carbon auth integration points (code-verified) + Supabase/GoTrue SSO capabilities (web-verified, sources at bottom).

## Current state in Carbon

- **No SSO/SAML/OIDC scaffolding exists** — zero matches for `signInWithSSO`, `saml`, `sso_provider`, `workos` in app code.
- Auth is Supabase GoTrue (`supabase/gotrue:v2.189.0` in both dev and prod compose) with magic link, Google + Azure OAuth (`signInWithOAuth`), passkeys, TOTP MFA, cookie sessions.
- The **callback flow is provider-agnostic**: `_public+/callback.tsx` consumes any Supabase session (refresh token POSTed to the action → `refreshAccessToken` → `carbon` cookie, with the MFA park-and-challenge gate). A new SSO method that yields a GoTrue session needs **no callback changes**.
- Provider gating: `AuthProvider` type (`packages/env/src/index.ts:116` — `"email" | "google" | "azure" | "passkey"`) + `AUTH_PROVIDERS` env + `isAuthProviderEnabled()`, consumed by ERP/MES login pages, unlock, `x+/_layout`, account security.
- Provisioning: `create_public_user()` trigger creates `public.user` + `userPermission` for any new `auth.users` row, but **not** `userToCompany`. Company attachment happens via invite (`acceptInvite` → `addUserToCompany` + permissions) or self-serve verify → onboarding (blocked entirely in Enterprise edition, `login.tsx:229`). A zero-company user gets forced into onboarding by `x+/_layout.tsx`.
- Per-company config pattern available: `integration` catalog + `companyIntegration.metadata` (jsonschema-validated), secrets in Supabase vault (post-NIST migration `20260817123719`).

## Supabase options (Aug 2026)

1. **Native SAML 2.0** (recommended): `supabase.auth.signInWithSSO({ domain })` → redirect URL → IdP → GoTrue session → existing `/callback`. Providers registered per-IdP with a `domains` array via CLI (`supabase sso add`) / Management API (hosted) or GoTrue admin REST `POST /auth/v1/admin/sso/providers` with service-role key (self-hosted, no restart needed). Hosted: **Pro plan+**, 50 SSO MAU included then $0.015/MAU. Self-hosted: `GOTRUE_SAML_ENABLED=true` + `GOTRUE_SAML_PRIVATE_KEY` (**base64 PKCS#1 DER**, not PKCS#8 — the #1 gotcha), SP metadata at `/sso/saml/metadata`, ACS at `/sso/saml/acs` (gateway routes must be open/no key-auth). Attribute mapping JSON → JWT claims + `identity_data`; assertion must contain email. `sso_provider_id` lands in the JWT (usable in RLS). SSO identities are deliberately never linked to existing accounts.
2. **Custom OIDC providers** (launched Apr 2026): `signInWithOAuth({ provider: "custom:okta-acme" })`, issuer-URL discovery, dashboard/admin-API config. Free = 3 providers, Pro+ = unlimited. **Self-hosted support unverified** — self-hosted docs still only document `GOTRUE_EXTERNAL_<PROVIDER>_*` env vars; verify against supabase/auth release notes before relying on it.
3. **Azure single-tenant**: existing `azure` provider accepts a tenant-specific URL (`https://login.microsoftonline.com/<tenant-id>`) — cheapest path if the only ask is "log in with our Entra". Watch the `xms_edov` unverified-email-domain claim.
4. **Brokers**: WorkOS (first-party Supabase docs but replaces GoTrue session issuance — clashes with Carbon's cookie/MFA/passkey stack), Ory Polis (ex-BoxyHQ Jackson; self-hostable SAML→OIDC bridge + SCIM 2.0), SSOReady (API middleware, you mint sessions yourself). Only needed if SCIM is a requirement — **Supabase Auth has no SCIM** as of mid-2026.

## Recommended approach: native GoTrue SAML

Works identically on self-hosted Docker and hosted Supabase (same GoTrue code), keeps one session system (cookie, MFA gate, claims cache all untouched).

Change points:

1. **GoTrue config**: `packages/dev/docker/docker-compose.dev.yml` + `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml` — add `GOTRUE_SAML_ENABLED` + `GOTRUE_SAML_PRIVATE_KEY` (per-env secret); mirror in `config.toml` for hosted parity; SST/managed path configures the Supabase project instead. Verify the dev/prod gateway exposes `/auth/v1/sso/saml/{metadata,acs}` unauthenticated.
2. **`packages/env/src/index.ts`**: add `"sso"` to `AuthProvider` (L116); include in `AUTH_PROVIDERS`.
3. **Login pages** (ERP `_public+/login.tsx`, MES mirror): gated "Continue with SSO" — take the already-entered email, call `carbonClient.auth.signInWithSSO({ domain, options: { redirectTo: /callback } })`, redirect to the returned URL. Callback: no changes.
4. **Provider registration**: per-customer-IdP via GoTrue admin API. Optionally an admin settings UI storing non-secret IdP metadata via the `integration`/`companyIntegration` + vault pattern; note providers are **global to the GoTrue project** — the `domains` array is the actual tenant router, and a domain can belong to only one provider.
5. **Provisioning decision (the real design question)**: SAML JIT-creates `auth.users` (trigger gives identity, not membership). Options: (a) invite-first — SSO user must have a pending/accepted invite, else "User not found" at callback; (b) JIT-attach — map SSO domain → companyId and auto-`addUserToCompany` with default permissions. Enterprise edition currently blocks unknown users only on the magic-link path — SAML bypasses that check, so the chosen policy must be enforced at callback or via a before-user-created Auth Hook.
6. **Optional domain enforcement**: block magic link/OAuth for SSO-managed domains via an app-side check in the login action (no native GoTrue enforcement exists).

## Key challenges (assessed 2026-08-21)

1. **Existing-user migration**: SSO identities never link to existing accounts — an existing user signing in via SAML gets a NEW `auth.users` id; `userToCompany`/permissions/audit keyed to the old id, and `create_public_user` will collide on the duplicate email. Needs a designed reconciliation or re-invite contract.
2. **Enterprise bypass**: the "reject unknown users" check lives only on the magic-link login path; SAML JIT-creation bypasses it. Enforce invite-first/JIT policy at callback or via an Auth Hook, else registered-IdP users get orphaned Carbon accounts.
3. **Asserted-email trust (VERIFY)**: unconfirmed whether GoTrue restricts assertion emails to the provider's registered domains. If not, a customer IdP could assert another company's domain — dangerous combined with any email-based reconciliation for #1.
4. **Tenancy mismatch**: providers are project-global; `domains` is the only router and a domain maps to one provider. Shared parent-org domains, contractors, multi-company users need an explicit domain→provider→company mapping table.
5. **Hosted vs self-hosted ops split**: self-hosted registers providers via GoTrue admin REST (automatable in-app); hosted goes through the Supabase Management API/CLI (personal access token, Pro plan) — an in-app SSO settings screen behaves differently per mode.
6. **MFA interplay**: SSO users get double-MFA'd by Carbon TOTP; `CONTROLLED_ENVIRONMENT` *forces* requireMfa (NIST 3.5.3), so any SSO exemption there needs a compliance rationale.
7. **No SCIM / no SLO**: IdP offboarding doesn't propagate; 7-day cookie keeps refreshing. v1 answer is manual deactivation (existing flows); Ory Polis/SSOReady are the later SCIM path.
8. **Dev/test story**: IdP must POST to the ACS URL — needs a mock SAML IdP container in dev compose; verify gateways expose `/auth/v1/sso/saml/{acs,metadata}` unauthenticated (prod Caddy compose was not configured for this).
9. **Smaller**: domain enforcement must also cover Google/Azure/passkey buttons; invite flow sends magic links (contradicts SSO-only domains); attribute mapping must satisfy `create_public_user` name-splitting; PKCS#1 key in Swarm secrets; IdP cert rotation; academy/starter hardcode login buttons.

## Decisions (Naveen, 2026-08-21)

- **Scope**: full SAML SSO *in addition to* the existing Google/Azure buttons — they coexist; SSO activates per registered email domain.
- **Deployment target**: self-hosted first — provider registration via GoTrue admin REST with the service-role key (no Supabase plan/Management API dependency).
- **Provisioning**: invite-first for v1 (reuses `acceptInvite` machinery, closes the Enterprise JIT bypass, no default-permissions design). JIT-attach deferred as a possible per-company toggle.
- **Migration contract**: "enabling SSO means your users get re-invited" — new SSO identity attached via invite. No id-remap migration in v1.
- **First-SSO-login migration (one atomic transaction)**: on a migrated user's first SSO login — (1) invite attaches new account with permissions, (2) all *assignable/mutable* references (assignees on open tasks, work orders, jobs, approvals) are automatically re-pointed from the old account (matched by email + company) to the new one, (3) old account deactivated in the same transaction (sessions invalidated, magic link dead, TOTP moot). Immutable audit fields (`createdBy` etc.) deliberately stay on the deactivated old account — same name/email so display is unchanged; audit trails are never rewritten. Deactivating-before-settling also gives the duplicate-email trigger collision a defined ordering.
- **Edition gating**: SSO is Enterprise-only (`CarbonEdition === Edition.Enterprise` gates the login button + settings screen).
- **MFA policy**: trust the IdP — skip Carbon TOTP for sessions bearing `sso_provider_id`, EXCEPT under `CONTROLLED_ENVIRONMENT=true`, where forced TOTP remains (NIST 800-171 3.5.3 needs attestable MFA).
- **Admin UX**: in-app Settings → SSO screen (Enterprise-gated): IdP metadata URL/XML + domains in, ACS + SP metadata URLs displayed out; server calls GoTrue admin API. Largest UI chunk of the project.

## Remaining open items

- Verify whether GoTrue restricts SAML-asserted emails to the provider's registered domains (challenge #3) — check supabase/auth source.
- Mock SAML IdP container for dev compose + gateway routes for `/auth/v1/sso/saml/{acs,metadata}`.
- Invite flow for SSO-managed domains currently sends magic links — needs an SSO-aware invite path.
- Whether to enforce SSO-only (block magic link/OAuth/passkey) for managed domains in v1.

## Sources

[Supabase SAML SSO](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml) · [Self-hosted SAML](https://supabase.com/docs/guides/self-hosting/self-hosted-saml-sso) · [Pricing](https://supabase.com/pricing) · [Custom OAuth/OIDC](https://supabase.com/docs/guides/auth/custom-oauth-providers) · [Custom OIDC blog](https://supabase.com/blog/custom-oauth-oidc-providers) · [Azure provider](https://supabase.com/docs/guides/auth/social-login/auth-azure) · [WorkOS third-party](https://supabase.com/docs/guides/auth/third-party/workos) · [Ory Polis](https://github.com/ory/polis) · [SSOReady](https://github.com/ssoready/ssoready) · [Self-hosted walkthrough](https://calvincchan.com/blog/self-hosted-supabase-enable-sso)
