# Single sign-on

> Route sign-in for your company's email domains through your own identity provider with enterprise SAML SSO.

Single sign-on hands control of Carbon sign-in to your own identity provider — Okta, Entra ID, Google Workspace, or any SAML 2.0 IdP. You register your email domains once, and from then on your IT team grants and revokes access centrally: everyone on those domains can sign in to both ERP and MES with **"Continue with SSO"**. Registering alone doesn't take anything away — the magic link and other methods keep working until you turn on [Require SSO](#requiring-sso).

## Requirements

SSO is an Enterprise feature. The **"Continue with SSO"** button and the settings section render only when the instance runs the **Enterprise** edition (`CARBON_EDITION=enterprise`), which requires a `docs/platform/licensing`. It is a capability of your own `docs/platform/self-hosting` deployment — Carbon Cloud sign-in is unaffected.

Enable it through `docs/platform/self-hosting/environment-variables`:

Add `sso` to the comma-separated list of sign-in methods. Without it, the button never renders.
Turns on the SAML engine in the auth service (GoTrue).
The SAML signing key — a base64-encoded PKCS#1 DER RSA key, minimum 2048-bit. The exact `openssl` generation command is in `.env.example`.

Carbon registers providers directly against the auth service with its service-role key — no Supabase account or plan is involved.

## Connect your identity provider

The whole exchange lives on one screen: **Settings** → **Security**, under the **"Single Sign-On"** heading. Viewing it requires the `settings` view permission; saving requires `settings` update.

**Copy Carbon's service provider details.** The **"Service Provider Details"** card shows the **"ACS URL"** and **"SP Metadata URL"** with copy buttons. Copy them from the screen rather than constructing them by hand.

**Register Carbon in your IdP.** In Okta, Entra ID, or Google Workspace, create a SAML application using those two URLs. The assertion must include an **email attribute** — the email is how Carbon matches each sign-in to a person and a company.

**Paste the IdP metadata back into Carbon.** In the **"Identity Provider"** card, provide either the **"IdP Metadata URL"** or the raw **"IdP Metadata XML"** — exactly one of the two — plus your **"Email Domains"**, then **"Save"**.

**Confirm the connection.** After saving, the **"Identity Provider"** card gains a **"Require SSO"** switch and a **"Deactivate"** button — the sign that the connection is active. From here on, users on the registered domains can sign in through your IdP.

- **IdP Metadata URL**: The SAML metadata URL published by your identity provider. Provide this *or* the XML, never both — the form rejects the submission with **"Provide either a metadata URL or metadata XML (exactly one)"**.
- **IdP Metadata XML**: The raw metadata document, for IdPs that don't publish a metadata URL.
- **Email Domains**: A comma-separated list of domains, e.g. `example.com, example.org`. Domains are lowercased and must be bare hostnames — no `@`, no spaces. A domain can belong to **one company only**: registering a domain another company already claimed fails with **"Domain example.com is already registered to another company"**.

To turn SSO off, use the **"Deactivate"** button in the Identity Provider card. It opens a **"Deactivate Single Sign-On"** confirmation warning that "Users on your registered domains will no longer be able to sign in through your identity provider. This cannot be undone." — the provider registration is deleted outright, and re-enabling means saving the connection again.

## How sign-in works

The login page is email-first. The user types their email, then clicks **"Continue with SSO"** — clicking with the field empty shows **"Enter your email first"**. Carbon checks whether the email's domain has an active connection (a rate-limited check that reveals nothing beyond yes or no); if it doesn't, the page shows **"SSO is not configured for your email domain."** Otherwise the browser redirects to your IdP, the user authenticates there, and lands back in Carbon signed in to the connection's company.

Before any session is created, Carbon enforces the connection's boundaries itself: the asserted email's domain must be one of the registered **Email Domains**. An assertion outside them is rejected with **"SSO sign-in rejected: this email domain is not registered for your company's SSO connection."** — even a misconfigured or hostile IdP can't sign someone into another company.

Provisioning is **invite-first** — there is no self-serve signup through SSO. Three outcomes:

- **Already a member** of the connection's company: signed straight in.
- **Has a pending invite**: the first SSO sign-in accepts it — the person lands in the company with exactly the invite's role and permissions.
- **Neither**: rejected with **"SSO sign-in succeeded but no invite exists for `jane@example.com`. Contact your administrator."** (the message names the address). Nothing is provisioned, so creating the invite and retrying just works.

Invites cooperate with this automatically: when you invite someone whose email domain has an active SSO connection, the invite email links to the login page with their address prefilled instead of carrying a magic-link code — the IdP is never bypassed, even on day one.

MES shows the same **"Continue with SSO"** button and enforces the same domain rules, but it doesn't run first-time provisioning. A brand-new SSO user who starts at MES sees **"Complete your first SSO sign-in in Carbon ERP, then return here."** — after that one ERP sign-in, MES works normally.

## Existing accounts

People who already sign in with a magic link or OAuth don't lose anything when SSO arrives.

The first SSO sign-in quietly attaches the SAML identity to the existing account. Nothing changes for the user: it's the same account, the magic link keeps working, and no invite is needed, because an existing member is already authorized.

Coverage follows the registered domains: every existing member whose email domain is registered with the connection signs in with SSO automatically on their next login, no re-invite needed. People not yet in the company still need an invite from the `docs/reference/people`; invite emails for these domains route to SSO automatically.

## Requiring SSO

Once the connection works, you can make it the only way in. The **"Identity Provider"** card carries a **"Require SSO"** switch: while it's on, anyone whose email domain is covered by the active connection can sign in **only** through your identity provider. Every other method is refused server-side — the magic-link form, Google and Outlook sign-in, and passkeys all answer with **"Your organization requires single sign-on. Use "Continue with SSO"."** and no session is created.

The ordering protects you from locking yourself out: the switch exists only on an active connection, so the path is always *set up SSO, prove a sign-in works, enforce last*. Turning the switch off — or deactivating the connection — immediately restores the other sign-in methods for those domains.

If enforcement is on and your identity provider is unreachable, nobody on the covered domains can sign in to turn it off. Operators of a self-hosted deployment can lift the requirement directly in the database:

```sql
UPDATE "ssoConnection" SET "requireSso" = false WHERE "companyId" = '<id>';
```

Magic-link sign-in works again on the next attempt; re-enable the switch once the IdP is healthy.

## Two-factor authentication

SSO sessions skip Carbon's `docs/reference/two-factor` and the company-wide two-factor requirement in every environment, including controlled (ITAR) deployments. Your identity provider already enforced its own MFA policy during sign-in, and challenging twice is friction without security — MFA attestation for SSO sign-ins belongs to the IdP policy. Magic-link logins still go through Carbon's own two-factor challenge.
