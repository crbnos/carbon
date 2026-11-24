---
paths: ["apps/erp/app/routes/_public+/callback.tsx", "apps/mes/app/routes/_public+/callback.tsx", "packages/auth/src/services/self-signup.server.ts"]
triggers: ["isSelfSignupBlockedForEmail", "signInWithOAuth"]
promoted: null
---
# OAuth signup bypasses app-level email gates — GoTrue provisions before your code runs

**Context:** The free/disposable-domain self-signup blocklist (#1661) was enforced only on the email/password path (`login.tsx` unknown-user branch, `verify.tsx` before `createEmailAuthAccount`). "Sign in with Google" / "Sign in with Outlook" (`signInWithOAuth`) let a gmail/outlook address self-sign-up anyway.

**Problem:** For OAuth there is no app-code seam before account creation. GoTrue creates the `auth.users` row during the IdP handshake and the `create_public_user` trigger fires inside that same transaction — all before the app's `/callback` action runs. So an email-path-only check has an OAuth-shaped hole, and the callback is the *first* point app code can react. The tempting "let it create, then delete it" teardown is a smell; the truly-earlier options (a GoTrue `before-user-created` hook, `GOTRUE_DISABLE_SIGNUP=true`, or a trigger `RAISE`) each cost more than they save (infra + Cloud config, or breaking existing-user first-time OAuth login, or a DB-resident blocklist + no edition signal + a raw error instead of a message).

**Rule:** Any signup/identity gate must cover OAuth, not just the email path, and OAuth is enforced in the auth callback's non-SSO branch (both ERP and MES). Gate on a GENUINE self-signup only — no company membership AND no pending invite — so existing members and invited contractors pass. Prefer *not minting a session* over deleting the account: a membership-less `user` row can access nothing and is reused by `createEmployeeAccount` if the address is later invited, so no teardown is needed and the email stays invitable. Keep the check + domain list in one shared home (`@carbon/auth/self-signup.server`) so every entry point (ERP login/verify/callback + MES callback) shares one copy.

**Applies to:** `apps/{erp,mes}/app/routes/_public+/callback.tsx` (non-SSO branch), `packages/auth/src/services/self-signup.server.ts`, and any future email/domain restriction — check the OAuth callback, not only the email/password flow.
