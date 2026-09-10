# SSO Domain Verification Research: Best Practices Survey

## Summary

Surveyed how Google Workspace, Microsoft 365/Entra ID, Atlassian, Slack, Stripe,
Dropbox, and WorkOS prove a customer owns an email domain before SSO (or account
capture) can be enabled for it, plus the implementation mechanics (Node.js DNS, the
IETF domain-verification BCP draft, ACME prior art) and Carbon's current state. The
industry answer is unanimous: **a DNS TXT record containing a high-entropy,
per-tenant token**, added by the customer's IT admin and checked by the vendor —
user-clicked "Verify" plus background polling, with a bounded pending window
(WorkOS: 30 days → failed). Vendors that gate *ongoing* SSO enforcement on the
domain (Atlassian, Stripe) keep the record permanently and re-check it periodically,
with Atlassian's warn → grace period → revoke flow being the humane model. Carbon
today has **no ownership proof at all**: `ssoConnection.domains TEXT[]` accepts any
regex-valid hostname, the connection goes active immediately, cross-company
uniqueness is a non-transactional app-side check, and no DNS-verification code
exists anywhere in the repo. Everything needed to add it exists: service-role
server code in `packages/ee/src/sso/`, Inngest for background polling/re-checks,
Redis for rate limiting, and the security-email pattern for notifications.

## Competitors Surveyed

- **WorkOS** — the B2B SSO-as-a-service reference; has a dedicated domain-verification API
- **Atlassian** — the best-documented *lifecycle* (periodic re-check, grace period, revoke)
- **Stripe** — domain verification specifically as the gate to SAML SSO enforcement
- **Google Workspace / Microsoft 365** — the giants; takeover/dispute processes
- **Slack / Dropbox** — domain claiming for invite enforcement and account capture
- **IETF `draft-ietf-dnsop-domain-verification-techniques`** (BCP, draft-13) + **RFC 8552/8555** — the standards floor

## Key Consensus Patterns

### 1. DNS TXT record is the method
All seven vendors use it; for Slack, Stripe, and WorkOS it is the *only* method.
Alternatives (HTML file upload, meta tag — Atlassian/Dropbox; MX record — Microsoft
fallback) exist for customers without DNS access, but TXT is always primary.
Email-to-admin@ verification is not offered by any surveyed SaaS vendor.

### 2. Record shape: dedicated underscore host + prefixed high-entropy token
- Value format: `<vendor>-verification=<token>` (Stripe: `stripe-verification=…`,
  Atlassian: `atlassian-domain-verification=…`, Google: `google-site-verification=…`).
- Host: older vendors use the domain apex; the modern/recommended practice (WorkOS
  guide, Slack wildcard flow `_slack-challenge`, ACME `_acme-challenge`, and the IETF
  draft's RECOMMENDED form) is a **dedicated underscore-prefixed hostname** like
  `_carbon-challenge.example.com` — avoids polluting the apex TXT set, can't collide
  with a real hostname (RFC 8552), and lets the customer delegate just that label.
- Token: ≥128 bits CSPRNG (ACME RFC 8555 §11.3 and the WorkOS guide both say 128),
  base32/hex/base64url-encoded, **unique per (tenant, domain)** — a global or
  domain-only token lets a hosting provider replay one customer's record to claim
  the domain for another account (GitHub Pages scopes by username, Azure by
  subscription ID, ACME hashes the account key into the record for this reason).

### 3. Verification trigger: user-click "Verify" AND background polling
Google/Microsoft/Atlassian/Slack/Stripe are click-to-verify; Dropbox and WorkOS
poll vendor-side and notify on success (better UX — DNS propagation takes minutes
to 72 h and users otherwise mash the button). WorkOS bounds the poll set with a
**30-day pending → failed expiry**, re-triggerable. Best practice is both: button
for immediate feedback (with distinct errors: domain doesn't exist / no record yet /
wrong token), polling for eventual success.

### 4. If verification gates SSO, the record is permanent and re-checked
- **Atlassian**: periodically re-checks; if the record disappears → email warning
  with a grace period → then the domain drops to unverified and **SAML SSO policies
  stop applying**. Holding a second method prevents this.
- **Stripe**: "don't delete the TXT record… Stripe frequently checks" — removal can
  cost Dashboard access.
- **Microsoft/Google**: record may be deleted after one-shot verification (their
  verification gates domain *addition*, not ongoing SSO).
- The IETF draft's frame: for persistent validations, **removal of the record is the
  revocation mechanism**, and providers must document the re-check frequency. This
  also mitigates the domain-resale/dangling problem (domain expires, is
  re-registered, old tenant still shows "verified").
- Practical cadence: daily-to-weekly scheduled job, N consecutive failures + admin
  notification + grace window before revoking — never a silent instant revoke
  (transient DNS outage must not kill a company's login).

### 5. One domain = one tenant, with a DNS-proof dispute path
Microsoft: exactly one tenant; disputes resolved by removing it in the owning
tenant or a support case (and "admin takeover" of unmanaged tenants via the same
TXT proof). Atlassian: one org; if a squatter holds your domain, **delete their
token from your DNS and the claim releases after 30 days** — DNS control is the
arbiter. Google: 24 h cooldown after removal; support-mediated disputes re-verified
via DNS. (Stripe is the deliberate exception, allowing one domain across multiple
accounts.) Carbon's existing first-come-first-served rule becomes *safe* once
claiming requires DNS proof — a squatter can no longer hold a domain they don't own.

### 6. Scope rules decided explicitly
- Subdomains: Microsoft auto-verifies subdomains of a verified root; Atlassian
  never inherits; Dropbox makes it a checkbox. (Carbon's callback does exact-match
  on the email domain, so exact-match verification per listed domain is the
  consistent choice.)
- Public email domains (gmail.com, outlook.com): Atlassian explicitly blocks them;
  the IETF draft says providers SHOULD NOT allow verifying public suffixes — use
  the Public Suffix List, or at minimum a consumer-domain denylist.
- Homograph/IDN: normalize to punycode (`xn--`) before storing/comparing;
  verification proves *control*, not legitimacy of a lookalike domain.

## Answers to Research Questions

1. **How do you do domain verification?** Issue a per-(company, domain) random
   token → show the admin a TXT record to add (`_carbon-challenge.<domain>` →
   `carbon-domain-verification=<token>`) → check DNS on demand + in the background →
   mark verified → only then let the domain participate in SSO.
2. **How is DNS checked from Node?** `node:dns/promises` `resolveTxt()` via an
   explicit `Resolver` with pinned public servers (1.1.1.1/8.8.8.8) and explicit
   `{timeout, tries}` (default c-ares backoff can hang ~75 s); TXT answers arrive
   as `string[][]` — join each record's chunks before comparing. Branch on
   `ENOTFOUND` (domain doesn't exist) vs `ENODATA` (no record yet). Alternative
   (and required in edge runtimes): DNS-over-HTTPS JSON APIs
   (`cloudflare-dns.com/dns-query`, `dns.google/resolve`) — fixed resolver, easy
   `AbortController` timeout; querying two independent resolvers and requiring
   agreement is a cheap spoofing mitigation. Plain single-vantage lookup is what
   virtually all SaaS vendors do; DNSSEC is not required of customers anywhere.
3. **Pending lifecycle?** WorkOS: `pending → verified | failed`, 30-day pending
   expiry, re-triggerable; verification success fires a webhook/event. Copy those
   states and the 30-day bound.
4. **Does the record stay?** Yes, for SSO: permanent record + periodic re-check +
   warn/grace/revoke (Atlassian model). One-shot deletion is only appropriate when
   verification gates a one-time action.
5. **Standards?** No RFC yet — `draft-ietf-dnsop-domain-verification-techniques`
   (BCP track, draft-13) is the reference; RFC 8552 (underscored names) and
   RFC 8555 (ACME DNS-01) are the published underpinnings.

## Carbon Current State (what the feature changes)

- `ssoConnection` (`20260820215433_sso-connection.sql`): `domains TEXT[] NOT NULL`,
  **no verification columns**, connection `active = TRUE` immediately on save.
- Validation is a hostname regex only (`settings.models.ts:69` —
  `/^[a-z0-9.-]+\.[a-z]{2,}$/`); `gmail.com` or a competitor's domain passes.
- Cross-company uniqueness: app-side `.overlaps("domains", …)` check in
  `upsertSsoConnection` (`packages/ee/src/sso/connections.server.ts:123-140`) —
  non-transactional, no DB constraint; GoTrue's project-wide domain uniqueness is
  the real backstop. First to claim owns the domain forever.
- Domains are pushed to GoTrue via the admin API (`provider.server.ts`) at save
  time; GoTrue's `auth.sso_domains` routes `signInWithSSO({domain})`.
- Enforcement reads: `sso.check` (public, rate-limited), `isSsoRequiredForEmail`
  (login/callback/passkey in ERP+MES), callback's exact `domains.includes(emailDomain)`.
- **No DNS/verification code in the repo** (only an SSRF `dns.lookup` guard in
  `packages/jobs/src/workflows/actions/url-guard.ts`). Available building blocks:
  Inngest scheduled jobs (retention pattern), `@carbon/kv` Ratelimit, security-email
  pattern (`mfa-email.server.ts`), `.ai/specs/2026-08-21-enterprise-saml-sso.md`
  (which never mentions ownership verification — this is a new requirement, and its
  risk table's "rogue IdP asserting another company's domain" item is exactly what
  verification mitigates at claim time).

## Recommended Approach for Carbon

1. **Record shape** (WorkOS/IETF-draft pattern): TXT at
   `_carbon-challenge.<domain>` with value `carbon-domain-verification=<token>`;
   token = 32 hex chars from `crypto.randomBytes(16)`, generated per
   (companyId, domain), stored server-side.
2. **Data model**: promote domains out of the `TEXT[]` into an `ssoDomain` table —
   one row per domain: `id, companyId, connectionId, domain (stored punycode,
   lowercase), verificationToken, status ('pending'|'verified'|'failed'),
   verifiedAt, lastCheckedAt, failedCheckCount, audit columns` — with a real
   **UNIQUE constraint on domain among non-failed rows**, closing the current
   race. (Alternative if the array must stay: parallel verification table keyed by
   (companyId, domain); the per-row table is cleaner and is what the read paths
   want anyway.)
3. **Flow**: admin adds domain → row created `pending`, UI card shows the exact
   TXT host/value with copy buttons → "Verify" button runs the DNS check
   server-side (Resolver with pinned public resolvers + timeouts, or DoH; distinct
   error messaging for NXDOMAIN / no-record / token-mismatch) → an Inngest
   scheduled job also polls pending domains (e.g. hourly) until a **30-day
   pending → failed** expiry → on success: mark verified, notify, and only then
   include the domain in the GoTrue provider registration. **Only verified domains
   are ever pushed to GoTrue** — an unverified domain can't capture logins.
4. **Ongoing re-verification** (Atlassian model): nightly Inngest job re-resolves
   verified domains; on missing/mismatched record increment `failedCheckCount`,
   email company admins at first failure (security-email pattern, bypasses
   notification prefs), and after N consecutive daily failures (e.g. 7) drop the
   domain to `pending` and remove it from GoTrue. Never revoke on a single failed
   check. This also gives squatter-dispute resolution for free: whoever controls
   DNS can starve out a stale claim, per Atlassian's 30-day release.
5. **Input hardening while at it**: normalize to punycode; reject public suffixes
   (Public Suffix List) and a consumer-email-domain denylist (gmail.com,
   outlook.com, yahoo.com, …); keep exact-match semantics (no subdomain
   inheritance — matches the callback's `includes` check; Atlassian's choice).
6. **Migration/grandfathering**: existing active connections' domains (if any
   production data exists by then) either grandfather as `verified` with a
   re-verification deadline, or force through verification with `requireSso`
   suspended until verified — decide in the spec. Since this branch is unmerged,
   the schema change may be foldable into the existing SSO PR.

### Open questions for the spec
- Re-verification in v1, or ship claim-time verification first and add the nightly
  re-check as a fast-follow? (Recommend: include it — it's one Inngest scheduled
  job, and the dangling-domain hole is real.)
- Grace parameters (N failures, notification cadence).
- Fold into the current SSO PR vs separate follow-up PR.
- DoH vs `node:dns` Resolver (decide by deploy target; Vercel Node runtime supports
  both — DoH with two-resolver agreement is the more robust choice).
- Whether `sso.check` / login enforcement should treat a connection with zero
  verified domains as inactive (recommend yes — `active` should imply ≥1 verified
  domain).

## Sources

- https://workos.com/docs/domain-verification
- https://workos.com/docs/domain-verification/api
- https://workos.com/guide/the-developers-guide-to-domain-verification
- https://support.atlassian.com/user-management/docs/verify-a-domain-to-manage-accounts/
- https://docs.stripe.com/get-started/account/sso/other
- https://knowledge.workspace.google.com/admin/domains/verify-your-domain-with-a-txt-record
- https://learn.microsoft.com/en-us/entra/identity/users/domains-manage
- https://learn.microsoft.com/en-us/entra/identity/users/domains-admin-takeover
- https://slack.com/help/articles/5513043606547-Claim-and-verify-email-domains
- https://help.dropbox.com/account-access/domain-verification-invite-enforcement
- https://www.ietf.org/archive/id/draft-ietf-dnsop-domain-verification-techniques-12.html
- https://datatracker.ietf.org/doc/draft-ietf-dnsop-domain-verification-techniques/
- https://datatracker.ietf.org/doc/html/rfc8555
- https://nodejs.org/api/dns.html
- https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/
- https://developers.google.com/speed/public-dns/docs/doh/json
- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages
- https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/app-service/reference-dangling-subdomain-prevention.md
- https://letsencrypt.org/2026/02/18/dns-persist-01
