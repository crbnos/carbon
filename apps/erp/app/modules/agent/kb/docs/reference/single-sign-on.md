# Single sign-on

> Route sign-in for your company's email domains through your own identity provider with enterprise SAML SSO.

Single sign-on hands control of Carbon sign-in to your own identity provider: Okta, Entra ID, Google Workspace, or any SAML 2.0 IdP. Register your email domains once, proving you own each with a DNS record, and everyone on them signs in to both ERP and MES with their normal work email — Carbon recognizes the domain and routes to your IdP automatically, no SSO button to find. Registering takes nothing away: the magic link and other methods keep working until you turn on [Require SSO](#requiring-sso).

## Requirements

SSO is an Enterprise feature of your own `docs/platform/self-hosting` deployment (`CARBON_EDITION=enterprise`, which requires a `docs/platform/licensing`). Carbon Cloud sign-in is unaffected. Enable it through `docs/platform/self-hosting/environment-variables`:

Add `sso` to the comma-separated list of sign-in methods.
Turns on the SAML engine in the auth service.
The SAML signing key: a base64-encoded PKCS#1 DER RSA key, minimum 2048-bit. The `openssl` command is in `.env.example`.

## Connect your identity provider

Everything lives on one screen: **Settings → Security**, under **"Single Sign-On"** (viewing needs `settings` view; saving needs `settings` update).

**Copy Carbon's service provider details.** The **"Service Provider Details"** card shows the **"ACS URL"** and **"SP Metadata URL"** with copy buttons.

**Register Carbon in your IdP** as a SAML application using those two URLs. The assertion must include an **email attribute**; the email is how Carbon matches each sign-in to a person and a company.

**Paste the IdP metadata back into Carbon.** In the **"Identity Provider"** card, provide the **"IdP Metadata URL"** *or* the raw **"IdP Metadata XML"** (exactly one), then **"Save"**. The card gaining a **"Require SSO"** switch and a **"Deactivate"** button is the sign the connection is active.

**Verify your email domains.** The **"Email Domains"** card appears once the connection exists. Add each domain your people sign in with, publish the DNS record it shows, and click **"Verify"**. Only verified domains route SSO sign-ins.

## Verifying a domain

Each added domain starts **Pending** with a unique TXT challenge shown on the card:

| Record | Value |
| --- | --- |
| **Host** | `_carbon-challenge.example.com` |
| **Type** | `TXT` |
| **Value** | `carbon-domain-verification=<your unique token>` |

Publish the record at your DNS host, click **"Verify"**, and on a match the domain flips to **Verified**. Verification is one-time; the TXT record can be deleted afterwards. A Pending domain has no effect anywhere, so adding one is always safe.

Only one company can hold a domain verified, first to prove DNS control wins, and the claim survives even if DNS control later changes hands. The clean handover is for the holding company to **Remove** the domain, which frees it for the new owner to verify.

## How sign-in works

The login page is email-first and the SSO fork is invisible: the user types their email, presses **"Continue"**, and Carbon either redirects to your IdP (active connection on that domain) or falls through to the ordinary magic-link flow. Before any session is created, the asserted email's domain must be one of the connection's **verified** domains, so even a misconfigured or hostile IdP can't sign someone into another company.

Provisioning is **invite-first**: no self-serve signup through SSO. An existing member signs straight in (their first SSO sign-in quietly links the SAML identity to their account; the magic link keeps working). Someone with a pending invite has it accepted by their first SSO sign-in, landing with exactly the invite's role. Anyone else is rejected by name and nothing is provisioned; create the invite in the `docs/reference/people` and the retry just works.

## Requiring SSO

Once a sign-in has worked, the **"Require SSO"** switch on the Identity Provider card makes the IdP the only way in for verified domains: magic links, Google, Outlook, and passkeys are all refused server-side. The switch exists only on an active connection, so the path is always *set up, prove a sign-in works, enforce last*. Turning it off — or **"Deactivate"**, which deletes the connection and releases the domain claims — immediately restores the other methods.

If enforcement is on and your IdP is unreachable, nobody on the covered domains can sign in to turn it off. Operators can lift it directly in the database, and magic-link sign-in works on the next attempt:

```sql
UPDATE "ssoConnection" SET "requireSso" = false WHERE "companyId" = '<id>';
```

SSO sessions skip Carbon's `docs/reference/two-factor` and the company-wide requirement in every environment, including controlled (ITAR) deployments: your IdP already enforced its own MFA policy at sign-in. Magic-link logins still get Carbon's own challenge.

## Behavior details and exact messages

Providers are registered directly against the auth service (GoTrue) with the service-role key; no Supabase account or plan is involved. The domain-has-SSO check on the login page is rate-limited and reveals nothing beyond yes/no.

Domain rules: lowercased bare hostnames only (no `@`, no spaces), punycode (`xn--`) for internationalized domains; public email providers (`gmail.com`, `outlook.com`, …) are refused. Several companies may hold a *pending* claim on the same domain at once — exclusivity kicks in at verification. Re-adding your own domain fails with "This domain has already been added". The metadata form rejects both-or-neither with "Provide either a metadata URL or metadata XML (exactly one)".

### Verification fails
Three causes, named in the message: the record isn't visible yet (DNS propagation — wait and retry); the value doesn't match the token (re-copy exactly); or the DNS lookup itself failed (the server's outbound DNS access is blocked). Gotcha: many DNS providers auto-append the domain to the record name — in Cloudflare enter only `_carbon-challenge` and check the preview shows the host once, not twice.

### "Verify" fails on a domain another company verified
Deliberately generic message so the button can't be used to probe which domains are registered where. Handover: the holder removes the domain, or a self-host operator deletes the claim (`DELETE FROM "ssoDomain" WHERE "domain" = 'example.com';`). The previous holder's provider registration keeps routing the domain until its connection is re-saved, but sign-ins on it are rejected once the row is gone.

### "SSO sign-in rejected: this email domain is not registered for your company's SSO connection."
The IdP asserted an email outside the connection's verified domains. Add and verify the domain, or fix the IdP's attribute mapping.

### "SSO sign-in succeeded but no invite exists for `jane@example.com`. Contact your administrator."
Invite-first provisioning: the person authenticated at the IdP but is neither a member nor invited. Create the invite and have them retry. Invite emails for SSO-active domains link to the login page with the address prefilled instead of a magic-link code, so the IdP is never bypassed.

### "Complete your first SSO sign-in in Carbon ERP, then return here." (MES)
MES enforces the same domain rules but doesn't run first-time provisioning. One ERP sign-in fixes it permanently.

### "Your organization requires single sign-on. Sign in with your work email to continue."
Require SSO is on and the user tried a non-SSO method on a verified domain. Expected; they sign in via email → IdP redirect. A pending domain enforces nothing.

### "Deactivate Single Sign-On" confirmation
Warns "Users on your registered domains will no longer be able to sign in through your identity provider. This cannot be undone." — the registration is deleted outright and domain claims released; re-enabling means saving the connection again and re-verifying domains.
