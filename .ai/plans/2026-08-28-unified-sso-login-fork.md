# Plan: Unified Email-First Login (invisible SSO fork)

> Spec: [.ai/specs/2026-08-28-unified-sso-login-fork.md](../specs/2026-08-28-unified-sso-login-fork.md)
> Date: 2026-08-28
> Branch: `sso-implementation-research`

Small, UI-only change across two near-identical login routes plus a copy reword in
three server auth paths. No data model, no new endpoint, no service change.

## Task 1 — ERP login: fold SSO into the email submit

File: `apps/erp/app/routes/_public+/login.tsx`

1. **Remove** the `hasSsoAuth`-gated "SAML SSO" `<Button>` block (currently ~L619-632).
2. **Remove** the `onSignInWithSSO` handler (~L444-498).
3. **Add** a local loading flag: keep `ssoError` state; keep/rename `ssoLoading`
   state (reuse the existing `const [ssoLoading, setSsoLoading] = useState(false)`).
4. **Add** an `onSubmit` to the `<ValidatedForm>` (the one with `action="/login"`).
   Implement the fork:

   ```tsx
   onSubmit={async (formData, event) => {
     // formData is validated { email, redirectTo?, turnstileToken? }
     if (!hasSsoAuth) return; // SSO off → normal magic-link submit
     setSsoError(null);
     const email = String(formData.email ?? "").trim().toLowerCase();
     const domain = email.split("@")[1];
     if (!domain) return; // let the server validate

     let enabled = false;
     try {
       const body = new FormData();
       body.append("email", email);
       const res = await fetch(path.to.api.ssoCheck, { method: "POST", body });
       enabled = res.ok ? Boolean((await res.json()).enabled) : false;
     } catch {
       enabled = false; // fall through to magic link; server gate is defense-in-depth
     }
     if (!enabled) return; // not an SSO domain → magic-link submit proceeds

     event.preventDefault(); // SSO domain → suppress the magic-link POST
     setSsoLoading(true);
     const { data: sso, error } = await carbonClient.auth.signInWithSSO({
       domain,
       options: {
         redirectTo: `${window.location.origin}/callback${
           redirectTo ? `?redirectTo=${redirectTo}` : ""
         }`,
       },
     });
     if (error) {
       setSsoError(error.message);
       setSsoLoading(false);
       return;
     }
     if (sso?.url) window.location.href = sso.url; // navigate away (leave loading on)
   }}
   ```

5. **Update** the `<Submit>` to reflect the SSO loading state:
   - `isDisabled={fetcher.state !== "idle" || ssoLoading || (!!CLOUDFLARE_TURNSTILE_SITE_KEY && !turnstileToken)}`
   - `isLoading={fetcher.state === "submitting" || ssoLoading}`
6. **Update** the separator gate: drop `hasSsoAuth` from the
   `(hasGoogleAuth || hasOutlookAuth || hasPasskeyAuth || hasSsoAuth)` expression
   → `(hasGoogleAuth || hasOutlookAuth || hasPasskeyAuth)`.
7. **Remove** now-unused imports if any (`LuKeyRound` if only the SSO button used
   it — verify with grep before removing). Keep `carbonClient`, `path`, `ssoError`.
8. Keep the `ssoError` feed into the existing `<Alert>` (already
   `ssoError ?? fetcher.data?.message`).

Verify: `grep -n "SAML SSO\|onSignInWithSSO\|hasSsoAuth" apps/erp/app/routes/_public+/login.tsx`
→ only `hasSsoAuth` in the loader/`onSubmit` remain; no button, no handler.

## Task 2 — MES login: same fold

File: `apps/mes/app/routes/_public+/login.tsx`

Mirror Task 1. MES differences to respect:
- No Turnstile, no `DEV_BYPASS_EMAIL`, no signup/verify — the `onSubmit` body is
  identical (it only reads `email` + `redirectTo`).
- The `<Submit>` has no turnstile clause: `isDisabled={fetcher.state !== "idle" || ssoLoading}`,
  `isLoading={fetcher.state === "submitting" || ssoLoading}`.
- MES `ValidatedForm` has no `action` prop (posts to self) — leave that as-is; add
  only `onSubmit`.
- Same separator-gate edit and same import cleanup.

Verify: `grep -n "SAML SSO\|onSignInWithSSO\|hasSsoAuth" apps/mes/app/routes/_public+/login.tsx`.

## Task 3 — Reword the require-SSO copy (remove the dead button reference)

Replace the three literals
`'Your organization requires single sign-on. Use "SAML SSO".'` with button-free copy:

`'Your organization requires single sign-on. Sign in with your work email to continue.'`

Files / sites:
1. `apps/erp/app/routes/_public+/login.tsx` — `SSO_REQUIRED_MESSAGE` (~L222-223).
2. `apps/mes/app/routes/_public+/login.tsx` — `SSO_REQUIRED_MESSAGE` (~L151-152).
3. `apps/erp/app/routes/_public+/callback.tsx` — non-SSO branch require-SSO refusal.
4. `apps/mes/app/routes/_public+/callback.tsx` — non-SSO branch require-SSO refusal.
5. `apps/erp/app/routes/api+/passkey.authenticate.verify.ts` — 403 message.
6. `apps/mes/app/routes/api+/passkey.authenticate.verify.ts` — 403 message (if present).

Find them all first:
`grep -rn 'requires single sign-on' apps/erp apps/mes`
Replace every occurrence with the identical new string (these are server-side
strings, not `<Trans>`; no extraction needed, but keep them identical across sites).

## Task 4 — Typecheck, lint, translate

```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
pnpm run lint
```

If the button label or any `<Trans>`/`` t`` `` string changed (it should not —
label kept), run `/translate`. The require-SSO strings are plain server strings,
not catalog entries, so no extraction is expected. Confirm with:
`pnpm lingui:extract` → `git status packages/locale` (expect no changes unless a
`<Trans>` was touched).

## Task 5 — Browser verification (mandatory, per repo rules)

Boot the stack and verify both apps with agent-browser (`/auth` + `/test`):

Preconditions: SSO requires Enterprise edition + `sso` in `AUTH_PROVIDERS` + a
verified `ssoDomain`. If the local stack isn't Enterprise/SSO-provisioned, at
minimum verify the **non-SSO path is unchanged** (magic link still sends; no
`/api/sso/check` call in the network tab when SSO is off) and that the SAML SSO
button is gone. Note in the run log which paths were exercised vs blocked by
environment.

Checks:
- [ ] Login card renders without a "SAML SSO" button (ERP + MES).
- [ ] SSO off: submit an email → magic-link "Check your email" state; no
      `/api/sso/check` request fired.
- [ ] (If SSO provisioned) submit a verified-domain email → redirect to IdP;
      submit a normal email → magic link.
- [ ] Screenshot the new single-button login card for the PR (per repo rule:
      net-new/visible UI changes ship with agent-browser screenshots).

## Task 6 — Commit

Per repo rules, only commit when the user asks. If asked, use `/check-and-commit`.
Conventional message, e.g.:
`feat(auth): unify login — auto-route SSO domains from the email field, drop the SAML SSO button`
Add `Tracking spec: .ai/specs/2026-08-28-unified-sso-login-fork.md`.

## Notes / guardrails

- Do NOT change `/api/sso/check`, `getSsoConnectionByDomain`, `isSsoRequiredForEmail`,
  the callbacks' SSO branch, or session/MFA logic.
- Keep the magic-link path byte-identical for non-SSO domains — the `onSubmit`
  returns early (no `preventDefault`) so `ValidatedForm` submits normally.
- The server `isSsoRequiredForEmail` gate stays — it is the reason the client can
  safely fail open to magic link on a check error.
