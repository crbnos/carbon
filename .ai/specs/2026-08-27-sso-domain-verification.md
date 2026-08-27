# SSO Domain Verification (DNS TXT)

> Status: draft
> Author: naveen + Claude
> Date: 2026-08-27
> Research: [.ai/research/sso-domain-verification.md](../research/sso-domain-verification.md)
> Parent spec: [2026-08-21-enterprise-saml-sso.md](2026-08-21-enterprise-saml-sso.md)

## TLDR

Require companies to prove ownership of an email domain — via a DNS TXT record challenge —
before that domain can route SSO logins. Domains move out of `ssoConnection.domains TEXT[]`
into a new `ssoDomain` table with a `pending → verified` lifecycle: an admin adds a domain,
Carbon issues a per-(company, domain) 128-bit token, the admin publishes
`_carbon-challenge.<domain>` TXT `carbon-domain-verification=<token>` at their DNS host and
clicks **Verify**; Carbon resolves the record server-side and, only on success, includes the
domain in the GoTrue provider registration. Verification is **one-shot and manual** — no
background polling, no periodic re-verification (user decision). Unverified domains can
never capture a login, never trigger `requireSso` enforcement, and never route
`signInWithSSO`. The unmerged `20260820215433_sso-connection.sql` migration is edited in
place (user decision — branch is unmerged; no new migration).

## Problem Statement

Today any company admin can register **any syntactically-valid domain** for SSO. The only
guards are a hostname regex (`settings.models.ts:69`) and a first-come-first-served,
non-transactional overlap check in `upsertSsoConnection`
(`packages/ee/src/sso/connections.server.ts:123-140`). Nothing proves the company owns the
domain. Concretely: a malicious or careless tenant can claim `competitor.com` (or
`gmail.com`), permanently squatting it — and with `requireSso` the claim actively interferes
with that domain's users. Domain ownership is asserted, never proven. Every surveyed vendor
(Google, Microsoft, Atlassian, Slack, Stripe, WorkOS) requires a DNS TXT ownership proof
before a domain participates in SSO or account capture (see research).

## Proposed Solution

1. **`ssoDomain` table** — one row per claimed domain (replaces the `domains TEXT[]`
   column): `domain`, `verificationToken`, `status ('pending' | 'verified')`, `verifiedAt`,
   linked to its `ssoConnection`. `UNIQUE ("companyId","domain")` plus a partial unique
   index on verified rows closes the concurrent-claim race at the DB level
   (revised 2026-08-28 — see Design Decisions).
2. **TXT challenge** — token = 32 hex chars (`crypto.randomBytes(16)`), unique per row.
   Record: host `_carbon-challenge.<domain>`, value `carbon-domain-verification=<token>`.
   Underscore-prefixed dedicated host + prefixed high-entropy value per the IETF
   domain-verification draft / RFC 8552 and the WorkOS/Slack/Stripe pattern.
3. **Manual verification** — a **Verify** button on Settings → Security runs
   `dns.promises.Resolver` (pinned to `1.1.1.1` + `8.8.8.8`, explicit
   `{ timeout: 5000, tries: 2 }`) → `resolveTxt("_carbon-challenge." + domain)`, joins
   chunked TXT strings, and requires an exact token match. Distinct failure messages for
   domain-not-found (`ENOTFOUND`), record-not-there-yet (`ENODATA`), token mismatch, and
   DNS errors. Real DNS always — **no dev bypass** (user decision; dev verification is done
   against a genuinely-owned domain).
4. **GoTrue gets verified domains only** — the provider is registered/updated with the
   connection's *verified* domain list. Every enforcement read
   (`getSsoConnectionByDomain`, `isSsoRequiredForEmail`, `sso.check`, the callback's
   domain-membership check, invite routing) resolves through verified domains, so a pending
   claim has zero effect on logins.
5. **Input hardening** — reject a curated denylist of public email providers
   (gmail.com, outlook.com, …) at validation time; keep the ASCII hostname regex (IDNs must
   be entered in punycode `xn--` form); exact-match semantics (no subdomain inheritance),
   matching the callback's existing `includes` check.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Verification method | DNS TXT only | Unanimous vendor primary (research §1); HTML-file/meta-tag alternatives add surface for marginal value in a B2B admin flow |
| Record shape | `_carbon-challenge.<domain>` TXT `carbon-domain-verification=<token>` | IETF draft RECOMMENDED underscore host (RFC 8552); prefixed value self-identifies in a crowded zone (Stripe/Atlassian/Google pattern) |
| Token | 32 hex chars from `crypto.randomBytes(16)`, per (company, domain) row, stable for the row's lifetime | ≥128-bit entropy (ACME §11.3, WorkOS guide); per-tenant scoping prevents replay by a DNS operator who set up another tenant's record |
| Verification trigger | Manual "Verify" button only — no background polling, no pending expiry | **User decision.** Pending rows persist until verified or removed; nothing to bound because nothing polls |
| Re-verification | **None** — verified is permanent until the domain is removed | **User decision** ("no nightly Inngest re-verification"). One-shot model (Microsoft/Google) rather than Atlassian's re-check + grace. The TXT record may be deleted after verification with no effect |
| Data model | New `ssoDomain` table; `ssoConnection.domains TEXT[]` **removed** | Per-domain status/token/timestamps don't fit an array; a real `UNIQUE ("domain")` replaces the racy app-side `.overlaps` check |
| Domain uniqueness | `UNIQUE ("companyId","domain")` + partial unique `("domain") WHERE status='verified'` | **Revised 2026-08-28** (superseded global `UNIQUE("domain")`): exclusivity attaches to verification, not the claim — a free pending row must not block the rightful owner (squatting vector). First to verify wins, race-free; cross-company verify conflicts fail with a deliberately generic message (no verified-elsewhere oracle) |
| Migration strategy | Edit `20260820215433_sso-connection.sql` in place; no backfill | **User decision** — branch is unmerged, so the squashed migration is still editable; dev DBs re-apply via rebuild (user-run). `20260825185617` doesn't reference `domains` and stands unchanged |
| GoTrue registration | Provider created with `domains: []`; domain list synced on each verify/remove | Only verified domains may route `signInWithSSO`. Build-time verification: confirm GoTrue accepts an empty/absent domains array on create; fallback (defer provider creation to first verification) documented in the plan if it refuses |
| Enforcement reads | All go through **verified** domains only | An unverified domain must be indistinguishable from an unregistered one at login time — `requireSso` and SSO routing degrade safely to ordinary login methods |
| Public email domains | Hardcoded denylist constant shared client+server (~20 consumer providers); no Public Suffix List dependency | DNS proof is the real gate (nobody can add TXT records to gmail.com); the denylist is fast, friendly UX. Avoids a new production dependency (Ask-First territory) |
| IDN / homograph | ASCII-only regex retained; IDNs enter as punycode | Verification proves control, not legitimacy; storing/compare in ASCII form avoids unicode-compare bugs with zero new code |
| Dev/test story | No bypass — real DNS check always | **User decision** (owns carbon.ms for genuine verification). Keeps the trust path single and un-forkable |
| Multi-tenancy (heuristic 1) | `ssoDomain`: `companyId`, composite PK `("id","companyId")`, `id('ssod')` default, audit columns | Convention |
| Service shape (heuristic 2) | New fns take `client` first, return `{ data, error }`, never throw; DNS check isolated in `verification.server.ts` returning a discriminated result | Convention |
| RLS (heuristic 3) | SELECT: employee role; INSERT/UPDATE/DELETE: `settings_update` — mirrors `ssoConnection` | Convention |
| Permissions (heuristic 4) | Reads under `view: "settings"`; add/verify/remove intents under `update: "settings"` on the existing `x+/settings+/sso.tsx` action | Mirrors existing SSO action gating |
| Forms (heuristic 5) | `ValidatedForm` + `ssoDomainValidator` (zod) intents; `domains` removed from `ssoConnectionValidator` | Convention |
| Module layout (heuristic 6) | Verification logic in `packages/ee/src/sso/verification.server.ts`; service fns in `connections.server.ts`; validators in `settings.models.ts` | Follows the EE SSO packaging (parent spec changelog 2026-08-26) |
| Backward compatibility (heuristic 7) | Pre-merge feature branch; `domains` array never shipped. ERP/MES login + callback contracts unchanged in shape (reads swap source) | No released surface changes |

## Data Model Changes

**Edit `packages/database/supabase/migrations/20260820215433_sso-connection.sql` in place**
(no new migration — user decision, branch unmerged):

1. Remove `"domains" TEXT[] NOT NULL` from `ssoConnection` and the
   `ssoConnection_domains_idx` GIN index.
2. Add after the `ssoConnection` block:

```sql
CREATE TABLE "ssoDomain" (
    "id" TEXT NOT NULL DEFAULT id('ssod'),
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,                  -- lowercase ASCII (punycode for IDNs)
    "verificationToken" TEXT NOT NULL,       -- 32 hex chars; published in DNS, not a secret
    "status" "ssoDomainStatus" NOT NULL DEFAULT 'pending',  -- PG enum ('pending','verified')
    "verifiedAt" TIMESTAMP WITH TIME ZONE,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "ssoDomain_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ssoDomain_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ssoDomain_connectionId_fkey" FOREIGN KEY ("connectionId", "companyId") REFERENCES "ssoConnection"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "ssoDomain_companyId_domain_key" UNIQUE ("companyId", "domain")
);

-- First-to-verify-wins: at most one VERIFIED row per domain across companies.
CREATE UNIQUE INDEX "ssoDomain_domain_verified_key" ON "ssoDomain" ("domain") WHERE "status" = 'verified';

CREATE INDEX "ssoDomain_companyId_idx" ON "ssoDomain" ("companyId");
CREATE INDEX "ssoDomain_connectionId_idx" ON "ssoDomain" ("connectionId", "companyId");
CREATE INDEX "ssoDomain_createdBy_idx" ON "ssoDomain" ("createdBy");

ALTER TABLE "public"."ssoDomain" ENABLE ROW LEVEL SECURITY;
-- Four standard policies mirroring ssoConnection:
-- SELECT: get_companies_with_employee_role()
-- INSERT/UPDATE/DELETE: get_companies_with_employee_permission('settings_update')
```

Notes:
- Uniqueness is two-level **by design** (revised 2026-08-28): `UNIQUE ("companyId","domain")`
  blocks a company's own duplicate; the partial unique index on verified rows makes
  first-to-verify-wins exclusive across tenants (replaces the racy app-side `.overlaps` check).
- `20260825185617_sso-connection-active-unique.sql` is untouched (no `domains` reference).
- Dev DBs that applied the pre-edit migration must be rebuilt/re-applied by the **user**
  (never rebuild autonomously); then `pnpm run generate:types` before typecheck.

## API / Service Changes

**`packages/ee/src/sso/verification.server.ts`** (new):
- `TXT_HOST_PREFIX = "_carbon-challenge"`, `TXT_VALUE_PREFIX = "carbon-domain-verification"`
- `generateVerificationToken()` — `crypto.randomBytes(16).toString("hex")`
- `getTxtRecord(domain, token)` → `{ host: "_carbon-challenge.<domain>", value: "carbon-domain-verification=<token>" }` (UI + tests use this one source)
- `checkDomainVerification(domain, token)` → `{ verified: true } | { verified: false, reason: "domain_not_found" | "no_record" | "token_mismatch" | "dns_error" }` — `dns.promises.Resolver` with `setServers(["1.1.1.1", "8.8.8.8"])`, `{ timeout: 5000, tries: 2 }`; joins each TXT record's chunk array before comparing; never throws.

**`packages/ee/src/sso/connections.server.ts`:**
- `upsertSsoConnection` — drops `domains` handling entirely (validation, `.overlaps` steal
  check, GoTrue domains payload). Creates the GoTrue provider with the connection's current
  verified domains (empty on first create).
- New: `getSsoDomains(client, companyId)`; `addSsoDomain(serviceRole, { companyId, connectionId, domain, createdBy })` (normalizes, denylist-checks, inserts pending row with fresh token; maps the unique-violation error to a friendly "already registered to another company" message); `verifySsoDomain(serviceRole, { companyId, domainId, updatedBy })` (loads row, runs `checkDomainVerification`, on success marks verified + `syncGoTrueDomains`); `removeSsoDomain(serviceRole, { companyId, domainId })` (deletes row; re-syncs GoTrue if it was verified); internal `getVerifiedDomains(serviceRole, connectionId, companyId)` + `syncGoTrueDomains(connection)` → `updateGoTrueSsoProvider(providerId, { domains })`.
- `getSsoConnectionByDomain(serviceRole, domain)` — now resolves via `ssoDomain`
  (`status = 'verified'`, join active connection); same signature/return shape, so
  `isSsoRequiredForEmail`, both `sso.check` routes, and the passkey/login/callback callers
  are unchanged.
- Callback domain check (ERP + MES): `connection.domains.includes(emailDomain)` becomes a
  verified-domain lookup for the connection (same failure behavior: destroy session, delete
  JIT orphan).
- `getSsoAwareInviteLink` / `getSsoInviteDomainError` — resolve through verified domains.

**`apps/erp/app/modules/settings/settings.models.ts`:**
- `ssoConnectionValidator` — remove `domains`; keep metadata URL/XML XOR refine.
- New `ssoDomainValidator` — single `domain`: trim → lowercase → regex
  (`ssoDomainRegex`, unchanged) → no `@` → not in `PUBLIC_EMAIL_DOMAINS`.
- New exported `PUBLIC_EMAIL_DOMAINS` (~20 entries: gmail.com, googlemail.com, outlook.com,
  hotmail.com, live.com, msn.com, yahoo.com, ymail.com, icloud.com, me.com, mac.com,
  aol.com, proton.me, protonmail.com, pm.me, gmx.com, gmx.net, mail.com, zoho.com,
  yandex.com, qq.com, 163.com, 126.com).

**`apps/erp/app/routes/x+/settings+/sso.tsx` action** — three new intents, same
`update: "settings"` + `isSsoEnabled()` gates: `addDomain`, `verifyDomain`, `removeDomain`.
Verify failures flash reason-specific messages ("We couldn't find a TXT record at
_carbon-challenge.example.com yet — DNS changes can take up to a few minutes to propagate",
"A TXT record exists but doesn't match this company's verification token", …).

## UI Changes

**Settings → Security (`x+/settings+/security.tsx`), SSO section:**
- Identity Provider card: the comma-separated **domains input is removed** (metadata +
  Require SSO + Deactivate remain).
- New **Email Domains** card (rendered when a connection exists): add-domain input
  (`ValidatedForm` + `ssoDomainValidator`), and a row per domain — domain name, status
  badge (Verified ✓ / Pending), and for pending rows the TXT instructions (Host / Type TXT /
  Value with copy buttons, from `getTxtRecord`) plus **Verify** and **Remove** buttons
  (fetcher-based, per-row pending states). A hint on the Require SSO switch when zero
  domains are verified ("Require SSO has no effect until a domain is verified").
- Loader adds `getSsoDomains` (already gated `view: "settings"` + `ssoEnabled`).

**No MES UI changes** (MES has no SSO settings; its login/`sso.check`/callback flow is
unchanged in shape).

**Docs:** update `docs/content/docs/platform/single-sign-on.mdx` (+ the agent-KB mirror)
— domain-verification setup steps, the TXT record shape, one-claim-per-domain rule, and the
operator dispute note (SQL delete of a squatting `ssoDomain` row).

## Acceptance Criteria

- [ ] Adding `example.com` creates a pending `ssoDomain` row with a 32-hex-char token, and
      the security page shows `_carbon-challenge.example.com` / TXT /
      `carbon-domain-verification=<token>` with copy buttons and a Verify button.
- [ ] Verify against a domain with no such TXT record fails with the "no record yet"
      message; the row stays pending; GoTrue's provider domain list does not include it.
- [ ] Verify against a domain whose TXT record matches flips the row to verified (with
      `verifiedAt`), and the GoTrue provider's domains now include it (assert via
      `getGoTrueSsoProvider`).
- [ ] A login email on a **pending** domain: `sso.check` returns `enabled: false`,
      `isSsoRequiredForEmail` returns false (magic link works normally), and a SAML
      assertion for it is rejected at the callback.
- [ ] The same domain added by a second company fails with "already registered to another
      company" (DB unique violation surfaced as a friendly error) — including under
      concurrent inserts.
- [ ] Adding `gmail.com` (any denylisted domain) is rejected at validation with a clear
      message, client- and server-side.
- [ ] Removing a verified domain deletes the row and removes it from the GoTrue provider;
      subsequent logins on that domain fall back to non-SSO methods.
- [ ] `requireSso` with only pending domains enforces nothing; after verification it
      enforces exactly as before this change.
- [ ] Unit tests: `checkDomainVerification` result mapping (mocked resolver: found /
      chunked TXT join / ENODATA / ENOTFOUND / timeout), token generation shape,
      `ssoDomainValidator` (normalization, denylist, regex), and the ee test suite still
      passes with the reads swapped to `ssoDomain`.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp --filter=mes`,
      `pnpm run lint`, and `pnpm --filter @carbon/ee test` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| GoTrue rejects a SAML provider with an empty domains array (breaks create-before-verify flow) | Med | Build-time verification against the running GoTrue before UI work; fallback design (nullable `providerId`, provider created on first verification) ready in the plan |
| Squatter parks a domain in `pending`, blocking the real owner | Low | A pending claim is inert (can't verify without DNS control, routes nothing); operator SQL documented for disputes — strictly better than today's full active capture |
| DNS resolver unreachable from the server (egress-restricted self-hosted install) | Low | `dns_error` result with a distinct message; pinned public resolvers (1.1.1.1/8.8.8.8) are the most commonly allowed; nothing breaks except the Verify action |
| Recursive-resolver negative caching delays verification after the record is added | Low | Reason-specific "propagation can take a few minutes" message; manual retry is the designed UX |
| Domain later expires / transfers while still verified (no re-verification by design) | Med | Accepted by user decision (no nightly re-check). Documented in the ops docs; the one-shot model matches Microsoft/Google |
| Existing dev DBs applied the pre-edit migration | Low | User rebuilds/re-applies (user decision to edit in place); flagged in the implementation handoff |

## Open Questions

> All resolved with the user (conversational interview, 2026-08-27) before this spec was
> written; recorded as the audit trail.

- [x] Verification at claim time only, or also ongoing? — **Answer:** Claim-time only.
      Manual Verify button; **no nightly re-verification** (explicit user decision,
      superseding the earlier research recommendation of the Atlassian model). Verified is
      permanent until the domain is removed.
- [x] Background polling of pending domains? — **Answer:** No — the user verifies manually.
- [x] New migration or edit the existing one? — **Answer:** Edit
      `20260820215433_sso-connection.sql` in place; the branch is unmerged so no backfill
      or compatibility path is needed.
- [x] Dev bypass for verification (can't own a test domain)? — **Answer:** No bypass —
      always run the real DNS check; the user owns carbon.ms and verifies genuinely.
- [x] Data model: cookie…/array vs table? — **Answer:** `ssoDomain` table (from the earlier
      recommendation round: "rest is fine"), with global DB-level domain uniqueness.
- [x] Public email domain blocking? — **Answer:** Yes, hardcoded denylist (accepted with
      "rest is fine"); no Public Suffix List dependency.

Build-time verifications (not design questions): GoTrue admin API behavior with an empty
`domains` array on create/update; exact `updateGoTrueSsoProvider` body requirements for a
domains-only update; `ssoConnection` references to `domains` swept across ee tests.

## Changelog

- 2026-08-27: Created. All open questions pre-resolved via user interview (see Open
  Questions). Research at `.ai/research/sso-domain-verification.md`. Supersedes the parent
  spec's `domains TEXT[]` design and its app-side `.overlaps` uniqueness check.
- 2026-08-27 (implementation): (1) The `domain_not_found` verify reason was collapsed into
  `no_record` — NXDOMAIN on `_carbon-challenge.<domain>` is the ordinary
  "record not published yet" answer even for a real domain, so the two are
  indistinguishable without a second base-domain query that buys nothing. (2) The
  connection lookups attach a computed verified-only `domains: string[]` (embed on
  `ssoDomain`), so the callbacks, `uncoveredSsoDomainError`, and `getSsoAwareInviteLink`
  needed zero changes. (3) `deactivateSsoConnection` now DELETES the connection's
  `ssoDomain` rows (before the GoTrue provider delete) — the global `UNIQUE("domain")`
  would otherwise leave the claims stranded under the dead connection, blocking the
  company (or the domain's real owner) from ever re-registering them.
- 2026-08-28 (revision): **Domain uniqueness redesigned** (user decision — the global
  unique made a free pending claim block everyone, a squatting vector). Now
  `UNIQUE("companyId","domain")` + partial unique `("domain") WHERE status='verified'`:
  pending claims coexist across companies; first to verify wins (race-free at the DB).
  `addSsoDomain` pre-checks the company's own duplicate (no error-code branching, per
  user preference); `verifySsoDomain` fail-fasts a cross-company verified conflict with
  a deliberately **generic** message — a distinct "verified by another company" reply
  would be an oracle for probing other tenants' domains. The `sso.tsx` action surfaces
  the services' string messages in flashes. Migration `20260820215433` edited in place;
  domain-claim release on deactivate is unchanged and still required (a stranded
  verified claim would block the domain's next owner).
- 2026-08-28 (revision 2): `status` converted from TEXT + CHECK to a PG enum
  `ssoDomainStatus` ('pending' | 'verified') so the generated types carry the union —
  every `.eq("status", ...)` / `update({ status })` / comparison in `@carbon/ee` and
  `erp` is compiler-checked with no shared constant. Migration edited in place.
