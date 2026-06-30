# carbon

Open-core manufacturing platform (ERP/MES/QMS + an academy app). TypeScript
monorepo: React Router (Remix-style) apps in `apps/{erp,mes,academy,starter}`,
shared packages in `packages/*`, Supabase Postgres + Deno edge functions in
`packages/database/supabase`. Multi-tenant SaaS (cloud) and self-hostable.
Every tenant is a `company`; users may belong to several companies.

## Auth shape

- `requirePermissions(request, { view|create|update|delete: "<module>" })` — the
  gate at the top of nearly every loader/action. Returns `{ client, companyId,
  userId, ... }`. Permissions are `<module>_<action>` (e.g. `parts_view`).
  Accepts `role` checks and a `bypassRls: true` flag (employees → service-role).
- `getCarbonServiceRole()` — RLS-bypassing service-role client. Legitimate in
  webhooks, edge functions, Inngest jobs, pre-session OAuth callback. Anywhere
  else it is a tenant-isolation escape hatch — flag if reachable from a request
  handler without a prior permission/companyId check.
- `getCarbon(accessToken)` — user-scoped client, RLS-enforced.
- Edge functions (Deno) auth via `requirePermissions(req, companyId, userId,
  {...})` from `functions/lib/supabase.ts`; `companyId`/`userId` come from the
  validated JSON body, NOT headers.
- API keys: `carbon-key` header, SHA-256 hashed, scoped `<module>_<action>` per
  company, rate-limited; `getCarbonAPIKeyClient` / `getAuthFromAPIKey`.

## Threat model

Highest impact = cross-tenant data access: a query or service-role call that
omits a `companyId` filter, or trusts a `companyId`/`userId` from the request
body/params instead of the session claims. Next: privilege escalation via a
missing or wrong `requirePermissions` module/action on a loader/action, and
IDOR on `$id` route params (object fetched by id without re-scoping to the
caller's company). Then: leaking secrets/PII through the public share + API
surfaces below.

## Project-specific patterns to flag

- **companyId from untrusted input.** Any DB write/read where `companyId` (or
  `userId`/`createdBy`) is taken from the request body, query, or route param
  rather than from `requirePermissions`/session claims — especially in edge
  functions and `api+/` routes.
- **Missing permission scope.** A loader/action that does data access without
  `requirePermissions`, or with a `view` scope where it mutates (should be
  `create`/`update`/`delete`), or with `bypassRls: true` not justified by an
  employee-only context.
- **Service-role + raw param.** `getCarbonServiceRole()` followed by a query
  filtered on a value pulled straight from `params`/body with no companyId guard.
- **Share-link / token endpoints.** Routes under `share+/` (`quote.$id`,
  `customer.$id`, `scar.$id`, …) serve documents to unauthenticated external
  parties — verify they enforce a share token/expiry and never widen beyond the
  single shared record.
- **Integration OAuth/webhook handlers** (`api+/integrations.*`, `api+/webhook`,
  `inngest.ts`): check signature/state verification and that `companyId` comes
  from verified payload, not a query param (Linear handler historically did not
  verify a signature).

## Known false-positives

- `getCarbonServiceRole()` inside `packages/database/supabase/functions/**`,
  Inngest jobs (`packages/jobs`), `_public+/callback`, and webhook routes is the
  intended privileged path — not a finding on its own.
- `_public+/health`, `_public+/callback`, `.well-known/oauth-*`, and login/auth
  routes are intentionally unauthenticated.
- `share+/*` routes are intentionally reachable without a session (gated by share
  token); flag only if the token/scope check is actually absent.
- `requirePermissions` with `bypassRls: true` is legitimate for employee/admin
  flows — only flag when the surrounding context isn't employee-gated.
