# Unified Email-First Login (invisible SSO fork)

> Status: draft
> Author: Brad + Claude
> Date: 2026-08-28
> Parent specs: [2026-08-21-enterprise-saml-sso.md](2026-08-21-enterprise-saml-sso.md),
> [2026-08-27-sso-domain-verification.md](2026-08-27-sso-domain-verification.md)

## TLDR

Collapse the redundant "SAML SSO" button on the login page into the email flow.
Today a user is shown BOTH a **SAML SSO** button and a **Sign in with Email**
button and is expected to know which one applies to them — most users don't know
what SAML/SSO means. Instead: the user enters their email and presses one button;
the app forks **behind the scenes** — if the email domain is an SSO-registered
(verified) domain it routes straight to that company's identity provider, and if
not it carries on with the existing magic-link / verification-code flow. No new
data model, no new endpoint, no server-side auth-contract change. The fork is a
client-side interception of the existing `ValidatedForm` submit, reusing the
existing `/api/sso/check` lookup and `signInWithSSO`. Applies to both apps that
have SSO login: **ERP** and **MES** (academy/starter have no SSO button).

## Problem Statement

The login card (`apps/erp/app/routes/_public+/login.tsx`,
`apps/mes/app/routes/_public+/login.tsx`) currently renders a stack of auth
buttons — Google, Outlook, Passkey, **SAML SSO** — then a separator, an email
input, and a **Sign in with Email** submit. The "SAML SSO" button
(`onSignInWithSSO`) reads the email input, calls `/api/sso/check`, and if the
domain is SSO-registered calls `carbonClient.auth.signInWithSSO({ domain })`.

Two problems:

1. **It's redundant and confusing.** "SAML SSO" is jargon. A user on an
   SSO-managed domain doesn't know they must press that specific button; a user
   on a normal domain doesn't know to ignore it. Both buttons take an email and
   "sign you in", so the page presents a decision the user isn't equipped to make.
2. **The failure copy leaks the jargon.** When a `requireSso` domain tries the
   magic link, the server returns `Your organization requires single sign-on. Use
   "SAML SSO".` — an instruction that points at the very button we want to remove.

The information needed to route correctly (is this domain SSO-registered?) is
already available server-side via `getSsoConnectionByDomain` and is already
exposed to the browser by `/api/sso/check`. The user should never have to make
this choice.

## Proposed Solution

**One email-first entry.** Remove the standalone "SAML SSO" button. Keep the
email field and its submit button as the single credential-less path. Intercept
the form submit: after client-side validation, if SSO is enabled for the
deployment AND the entered email's domain resolves to an SSO connection, prevent
the ordinary magic-link POST and instead run `signInWithSSO(domain)` →
redirect to the IdP. Otherwise let the form submit exactly as it does today
(magic link for existing users, verification-code signup for unknown users in
non-Enterprise ERP).

The interception uses `ValidatedForm`'s existing `onSubmit(data, event)` hook
(`packages/form/src/ValidatedForm.tsx:454-459`): it runs after validation, and
if it calls `event.preventDefault()` the library skips the real submit. This is
the designed extension point — no form-library changes, no manual form wiring.

### Flow

```
User types email → presses the one button
        │
        ├─ SSO not enabled for deployment (!hasSsoAuth) ─────────► magic-link POST (unchanged)
        │
        └─ SSO enabled → POST /api/sso/check { email }
                 │
                 ├─ enabled:false / network error ───────────────► magic-link POST (unchanged)
                 │
                 └─ enabled:true → event.preventDefault()
                          → carbonClient.auth.signInWithSSO({ domain })
                          → window.location = idpUrl  ─────────────► IdP → /callback
```

Google / Outlook / Passkey buttons are **unchanged** — only the SAML SSO button
is removed and its logic folded into the email submit.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fork trigger | On `/api/sso/check` `enabled` (domain has an active connection with a VERIFIED domain) — regardless of `requireSso` | Matches what the removed SSO button already did (it forked on `enabled`), matches the user's stated model ("if the domain is an SSO registered domain, redirect to the IDP"). A company that set up SSO wants its domain's users on the IdP. `requireSso` remains the **server-side enforcement** flag (blocks a direct magic-link POST), not a UI-routing flag. **Trade-off:** a domain that is `enabled && !requireSso` (SSO configured but the admin deliberately left magic link allowed) will now be routed to SSO from this page too — see Risks; surfaced for veto |
| Where the fork lives | Client-side, in `ValidatedForm`'s `onSubmit` + `event.preventDefault()` | `signInWithSSO` is a browser GoTrue call that returns the IdP redirect URL for the browser to navigate to — it MUST run client-side. Reuses the exact `/api/sso/check` + `signInWithSSO` logic the old button had. No server action change on the happy path; magic-link path byte-identical |
| Skip the check when SSO is off | `if (!hasSsoAuth) return` before any fetch | The vast majority of deployments (Community/Cloud) have no SSO — never pay a round-trip. `hasSsoAuth` already comes from the loader (`isSsoEnabled()`) |
| Fallback on check failure | `enabled:false` on any non-OK / network / parse error → fall through to magic link | The server `isSsoRequiredForEmail` gate is defense-in-depth: a required-SSO domain that slips through the client check is still refused server-side. Failing open to magic link never leaks and never hard-blocks |
| Button label | Keep **"Sign in with Email"** unchanged | Minimal diff, zero translation churn, and it aligns with "fork behind the scenes" — the user still signs in by entering their email; the redirect is the invisible fork they asked for. (Alternative "Continue" noted for veto) |
| Server require-SSO copy | Reword the three `'…requires single sign-on. Use "SAML SSO".'` strings to not reference the removed button | The button it names no longer exists. New copy guides the user to the email flow (which now auto-forks) without jargon about a specific control |
| Loading state | Local `ssoLoading` state OR-ed into the submit's `isLoading`/`isDisabled` | RVF's own submitting state ends when `onSubmit` returns; without a local flag the button would show no spinner during the `/api/sso/check` + `signInWithSSO` round-trips before the IdP redirect |
| Keep `/api/sso/check` and its shape | No change to the endpoint | Still returns `{ enabled, required }`; the fork only needs `enabled`. `required` stays for any future use and is harmless |
| Scope | ERP + MES only | The two apps with an SSO button. academy/starter have no `hasSsoAuth` path. Callbacks/provisioning unchanged |
| Backward compatibility (heuristic 7) | Purely additive client interception + one string reword. Non-SSO logins byte-identical; SSO logins take the same `signInWithSSO`→`/callback` path the button took | No data-model, endpoint, or session-contract change |

## Data Model Changes

None.

## API / Service Changes

None to services or endpoints. `/api/sso/check` (`apps/{erp,mes}/app/routes/api+/sso.check.ts`)
is unchanged. `getSsoConnectionByDomain` / `isSsoRequiredForEmail` unchanged.

The only server-side edit is copy: the `SSO_REQUIRED_MESSAGE` literal in the
login actions, the callback non-SSO branch, and the passkey verify route.

## UI Changes

Both `apps/erp/app/routes/_public+/login.tsx` and
`apps/mes/app/routes/_public+/login.tsx`:

1. **Remove** the `hasSsoAuth`-gated "SAML SSO" `<Button>` from the button stack.
2. **Remove** the standalone `onSignInWithSSO` handler (its logic moves into the
   form submit).
3. **Add** an `onSubmit` prop to the `ValidatedForm` that performs the fork
   (validate → check SSO when `hasSsoAuth` → `preventDefault` + `signInWithSSO`
   on an SSO domain, else fall through).
4. **Keep** the `ssoError` state + the existing `Alert` (now fed only by a
   `signInWithSSO` failure, not by "SSO not configured for domain").
5. **Keep** the separator gate expression, but it no longer needs to include
   `hasSsoAuth` (the separator now shows when Google/Outlook/Passkey exist).
6. Add a local `ssoLoading` state to keep the submit button in a loading state
   through the check + redirect.
7. **Keep** the button label "Sign in with Email".

No layout/spacing redesign — the SSO button simply disappears from the stack.

## Acceptance Criteria

- [ ] The login page (ERP and MES) shows **no** "SAML SSO" button.
- [ ] With SSO disabled (Community/Cloud default), entering any email and pressing
      the button behaves exactly as today (magic link for existing users; ERP
      verification-code signup for unknown users) and makes **no** call to
      `/api/sso/check`.
- [ ] With SSO enabled, entering an email on a **verified SSO domain** and pressing
      the button redirects to the IdP (`signInWithSSO` URL) — no magic link is
      sent, no login action POST occurs.
- [ ] With SSO enabled, entering an email on a **non-SSO domain** sends the magic
      link / routes to verification exactly as today.
- [ ] A `signInWithSSO` error surfaces in the existing Authentication Error alert;
      the form is not left in a stuck submitting state.
- [ ] If `/api/sso/check` errors or times out, the submit falls through to the
      magic-link path (and a `requireSso` domain is still refused server-side by
      the unchanged `isSsoRequiredForEmail` gate).
- [ ] The submit button shows a loading state during the SSO check + redirect.
- [ ] No occurrence of `Use "SAML SSO"` remains in app copy; the require-SSO
      message no longer names a removed button.
- [ ] `pnpm exec turbo run typecheck --filter=erp --filter=mes` and
      `pnpm run lint` pass. Missing i18n strings filled via `/translate`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `enabled && !requireSso` domains lose magic-link access from this page (auto-forked to SSO) | Med | Matches the removed button's behavior and the user's stated intent; the admin can drop the SSO domain if they want magic link. Surfaced for veto. A future refinement could fork only on `required` and keep a small "Use SSO instead" affordance for enabled-not-required — deliberately not built now |
| An SSO user with JS disabled can't fork (client-only) | Low | Pre-existing: `signInWithSSO` was always a client SDK call. The server gate still refuses magic link on required domains; wording now guides to email |
| Extra `/api/sso/check` round-trip on every SSO-enabled login submit | Low | One POST, already rate-limited 20/h/IP; skipped entirely when SSO is off |
| `onSubmit`/`preventDefault` timing regressions in `ValidatedForm` | Low | Uses the documented proxy behavior (`await onSubmit` then check `defaultPrevented`); covered by the acceptance criteria and browser verification |

## Open Questions

> Resolved autonomously per the user's instruction ("don't grill me, just operate
> autonomously"); recorded here for the veto trail.

- [x] Fork on `enabled` or only `required`? — **enabled** (matches the removed
      button and the user's description). `requireSso` stays server-side enforcement.
- [x] Client-side or server-side fork? — **client-side** (`signInWithSSO` must run
      in the browser); zero server-contract change.
- [x] Rename the button? — **no** ("Sign in with Email" kept; minimal diff, aligns
      with "fork behind the scenes").
- [x] Scope? — **ERP + MES** (the only apps with SSO login).

## Changelog

- 2026-08-28: Created. Builds on the shipped enterprise SSO + domain-verification
  work on branch `sso-implementation-research`. No data-model/endpoint change —
  pure login-UX unification via a client-side submit fork.
- 2026-08-28 (enhancement): Pass `login_hint=<email>` to the IdP. `signInWithSSO`
  (auth-js 2.80.0) has no `login_hint` option and returns `data.url` = the IdP's
  SAML redirect-binding endpoint, so the fork appends `login_hint` via
  `URLSearchParams.set` (URL-encoded) before navigating. Safe by construction: the
  redirect-binding signature covers only `SAMLRequest`/`RelayState`/`SigAlg`, so an
  extra param never invalidates it; Okta/Entra prefill the username, other IdPs
  ignore it. Applied to both ERP and MES login. Not live-verifiable here (needs a
  configured SAML provider); typecheck + lint pass.
