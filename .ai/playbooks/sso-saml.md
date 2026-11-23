# Playbook: SAML SSO end to end (mocksaml.com)

Settings → Security SSO cards, the login fork, the ERP and MES callbacks.
Verified 2026-10-29.

## Setup (local only)

1. Root `.env` (gitignored): `SAML_ENABLED=true`, `SAML_PRIVATE_KEY=<base64 PKCS#1 DER>`
   (command in `.env.example`), and `sso` in `AUTH_PROVIDERS`.
2. `crbn reload gotrue`, then `curl https://api.<slug>.dev/sso/saml/metadata` → 200.
   Restart the apps (`crbn up`) so they read `AUTH_PROVIDERS`.
3. **Use your own browser session**: `export AGENT_BROWSER_SESSION=<name>`. The default
   session is shared with other worktrees' agents and will jump to their ERP.
   Use one session for the admin and a fresh one per SSO sign-in.

## IdP

mocksaml.com: metadata URL `https://mocksaml.com/api/saml/metadata`. Its login page
takes a username plus a `@example.com` / `@example.org` select, any password.
`@example.org` is how you test a domain mismatch.

## Verifying example.com

Verification is real DNS only (no dev bypass). To run the real verify path
(GoTrue PUT, backfill), temporarily add at the top of `checkDomainVerification`
(`packages/ee/src/sso/verification.server.ts`):
`if (domain === "example.com") return { verified: true } as DomainVerificationResult;`
then reload the page, click Verify, and REVERT the line straight after
(`git diff --quiet HEAD -- <file>`).

## Flows and expected results

| Flow | Expected |
|---|---|
| Connect: empty / both / bad URL | "Provide either … (exactly one)" / same / "Must be a valid URL" |
| Connect with mocksaml URL | "SAML SSO connection saved", status Active |
| Add `gmail.com`, `not a domain`, `xn--80ak6aa92e.xn--p1ai` | public-provider error / hostname error / added |
| Verify with no TXT record | "No TXT record found yet …" |
| Invite any email, connection with NO verified domain | invite succeeds |
| Invite off-domain once example.com is verified | "Single sign-on is active for example.com …" |
| Login `x@example.com`, not invited | IdP → toast "… no invite exists …"; no auth/public user left |
| Login invited `jackson@example.com` | IdP → `/x` "…, Jackson."; invite accepted, same user id |
| Require SSO on; magic link for example.com (stub `/api/sso/check` → `{"enabled":false}` with `agent-browser network route`) | "Your organization requires single sign-on …" |
| MES login, ERP-provisioned user | `/x/operations` |
| MES login, `@example.org` asserted / on-domain with no invite | refused; no auth/public user left |
| MES login, invited but not yet signed in to ERP | "Complete your first … in Carbon ERP"; the invited user stays |
| Deactivate → Connect → add + verify → login jackson | `/x`; jackson has one `sso:` identity |
| Remove a domain | confirm modal (copy differs for pending / verified); Cancel changes nothing; Remove → "Domain removed" |
| Deactivate while GoTrue fails (temporarily return an error from `deleteGoTrueSsoProvider`) | "Failed to deactivate …"; connection, domains, Require SSO unchanged |
| Deactivate where the commit fails after GoTrue succeeded (temporarily throw after `providerDeleted = true`) | "deactivated"; the retry releases the domains |
| A claim left under an inactive connection | Connect (same company), Add or Verify (that domain) removes it; Add no longer says "already added" |
| GoTrue provider left alive under an inactive connection (`update "ssoConnection" set active=false` with SQL) | Connect deletes it and creates a new provider (else GoTrue: `saml_idp_already_exists`); Verify then moves the domain to it |

## Sign-ups off (production setting)

Dev runs GoTrue with sign-ups ON; production with them OFF. Add
`GOTRUE_DISABLE_SIGNUP=true` to root `.env`, `crbn reload gotrue` (this signs the
admin out). Then:

| Flow | Expected |
|---|---|
| Invited user, first SSO sign-in | `/x`, invite accepted |
| Un-invited user on a verified domain | `/login?error=signup_disabled` with "There is no Carbon account for this email yet …" |
| Member with `is_sso_user = true`, after deactivate → reconnect → verify | backfill seeds them; SSO sign-in reaches `/x` |

## Notes

- Submit forms with `requestSubmit` (see `/test`). Toasts fade in a few seconds:
  poll right after the redirect, or read `login.data` in `agent-browser network`.
- `/api/sso/check` is rate-limited to 20/hour per IP; after that it answers 429
  `{"enabled":false}` and the login falls back to magic link silently. curl probes
  count too. Clear it locally: `docker exec carbon-redis redis-cli -n <db> --scan
  --pattern '*sso-check*'`, then `del` the keys.
- A flash set on a FULL page load is not toasted (only client navigations are);
  don't read a missing toast after a document redirect as "no message sent".
- Check state with `docker exec <project>-postgres-1 psql -U postgres -tAc …`
  (`"ssoConnection"`, `"ssoDomain"`, `auth.sso_domains`, `auth.identities`).
