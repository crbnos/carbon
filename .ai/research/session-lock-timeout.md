# Session Lock & Termination Research: Best-Practice Survey

## Summary

Researched how to implement **session lock (NIST 800-171 3.1.10 / 800-53 AC-11)**
and **session termination (3.1.11 / AC-12)** for Carbon (React Router v7 +
Supabase-Auth cookie session), against three sources: the normative NIST/CMMC/DISA
control text, OWASP + comparable enterprise apps (AWS, Salesforce, Supabase,
HIPAA/EHR), and Carbon's actual session code.

**The two controls are distinct and BOTH are required** — lock ≠ termination is an
explicit assessment point. A **lock** (3.1.10) obscures the screen after inactivity,
*preserves* the session, and clears only on re-authentication. A **termination**
(3.1.11) ends the logical session on an org-defined condition (inactivity is the
condition assessors most expect; an absolute max-lifetime is a valid additional
condition but not separately mandated). Both must be **server-authoritative** — a
client-side idle timer is UX only and is a security anti-pattern as the boundary.

Carbon's constraint that shapes everything: the session is a **signed react-router
cookie wrapping GoTrue JWTs, with no server-side session store and no
created-at/last-active timestamp**. So idle + absolute enforcement means adding
timestamps to the `AuthSession` payload and checking them at the one always-run
choke point (`requireAuthSession`, called by `requirePermissions` on every
authenticated leaf loader/action). Supabase's own timebox/inactivity knobs are
Pro-tier and only bite at the ~50-min refresh boundary — too coarse — so the app
must own enforcement.

## Standards & Apps Surveyed

- **NIST SP 800-53 Rev 5 AC-11 / AC-11(1) / AC-12** + **800-171 Rev 2 §3.1.10 /
  §3.1.11** (Rev 3 renames 3.1.10 to "Device Lock") — the controls being satisfied.
- **DISA Application Security & Development STIG** (rule V-222389) — the only
  source giving a concrete web-app number: **15 min** idle.
- **CMMC 2.0 L2 Assessment Guide** (AC.L2-3.1.10 / 3.1.11) — how an assessor checks.
- **OWASP Session Management Cheat Sheet / ASVS 3.3** — idle vs absolute vs renewal
  timeout; server-side enforcement mandate.
- **AWS Console** (12h hard cap, 20-min SSM idle), **Salesforce** (15min–24h
  configurable, 2h default, warning dialog), **Supabase Auth/GoTrue** (timebox +
  inactivity session controls), **HIPAA/EHR** guidance (automatic logoff §164.312).
- **react-idle-timer** — the standard client idle-UX library (cross-tab support).

## Key Consensus Patterns

### 1. Lock and termination are separate controls; implement both

- **NIST**: AC-11 lock is "temporary… not an acceptable substitute for logging
  out"; AC-12 "terminates all processes associated with a user's logical session."
  You cannot satisfy 3.1.11 with a lock, or 3.1.10 with a logout.
- **Rationale**: 3.1.10 protects the *display* (someone walks up to an unattended
  screen); 3.1.11 protects the *session* (bounds how long an unattended or hijacked
  session stays usable). Different threats → both required.
- **Practical shape for a web app**: a short **idle lock** (obscure + re-auth to
  resume, session preserved) *layered over* a real **server-side session
  expiry/termination** (idle-terminate + optional absolute max-age → full re-login).

### 2. Idle threshold is org-defined; 15 min is the defensible default

- **NIST/CMMC**: the period is `[Assignment: organization-defined]`; the assessor
  checks that you *defined and enforce* a period, not a specific number. NIST's
  Discussion example is 5 min.
- **DISA STIG**: **15 min** for non-privileged web-app sessions (V-222389).
- **OWASP**: idle 2–5 min (high-value) to 15–30 min (low-risk); **absolute 4–8h**
  for a full-workday app. AWS caps at 12h; Salesforce defaults 2h.
- **Consensus default for a CUI ERP**: **idle 15 min**, **absolute ~8–12h**, with a
  **warning prompt** at ~50–90% of the idle window.

### 3. Server-authoritative enforcement; client is UX only

- **OWASP/ASVS**: "Session timeout… must be enforced server-side. If the client is
  used to enforce the session timeout… an attacker could manipulate these." A
  stolen token replayed against the API must be rejected server-side regardless of
  any client timer.
- **Standard split**: client (react-idle-timer) tracks real mouse/keyboard/touch/
  visibility → drives warning modal + lock overlay; server independently records
  session start + last-activity and rejects/refreshes based on them. AWS,
  Salesforce, EHRs all enforce server-side.

### 4. The lock is a pattern-hiding overlay cleared by re-authentication

- **AC-11(1)**: "Conceal… information previously visible on the display with a
  publicly viewable image" → a full-viewport overlay that removes CUI from view
  (blank/solid/clock), content not merely blurred-but-present in the DOM.
- **AC-11**: "Retain the device lock until the user reestablishes access using
  established identification and authentication procedures" → unlock requires
  **re-auth**, not just activity. A screensaver that doesn't force re-auth fails
  (explicit in HIPAA guidance too).

### 5. Absolute lifetime must be tracked independently of token refresh

- **The trap**: with rotating refresh tokens an active user mints new access tokens
  forever — sliding expiry never ends. Enforce an absolute cap by storing a
  **session-start timestamp** and, on every request/refresh, forcing full re-login
  when `now - sessionStart > absoluteMax`. Do not let refresh reset it.
- Many OIDC providers lack a built-in absolute knob (authentik, MS moved to
  Conditional Access sign-in-frequency); apps enforce it themselves. Auth0 exposes
  paired idle+absolute refresh expiry; AWS hard-caps at 12h.

### 6. Cross-tab coordination via BroadcastChannel

- Activity in any tab resets the shared idle timer; a lock/logout in one tab
  broadcasts and all tabs follow. Modern primitive is **BroadcastChannel** (Web
  Locks to elect one refresh leader). **react-idle-timer has this built in**
  (`crossTab`, `leaderElection`, auto broadcastChannel + localStorage fallback).

## Answers to Research Questions

1. **Do the controls mandate a specific idle duration?** No — org-defined. NIST
   example 5 min; DISA STIG 15 min for web apps; OWASP 15–30 min general. **Use 15
   min** as the controlled-environment default (documented, defensible).
2. **Lock overlay vs full logout; can logout satisfy 3.1.10?** 3.1.10 wants a
   *lock* — obscure + preserve + re-auth-to-unlock — and explicitly says a lock is
   "not a substitute for logging out." A full logout implements *termination*
   (3.1.11), not the lock. Need both.
3. **Does unlocking require re-authentication?** Yes — AC-11 requires re-establishing
   access via I&A procedures; activity alone must not clear the lock.
4. **What is 3.1.11 termination and what triggers it?** Terminating the logical
   session (kill processes/resources, new logon required) on an org-defined
   condition. Inactivity is the condition assessors most expect; absolute
   max-lifetime and time-of-day are valid additional conditions; only "define ≥1 and
   enforce it" is mandated.
5. **Lock vs termination normative distinction?** Yes: LOCK = inactivity/user-init,
   short-term, session preserved, cleared by re-auth. TERMINATION = defined
   condition, session ended, new logon required.
6. **Is OS device-lock enough for a remote browser session on CUI?** No — the
   server session stays open behind an OS lock. NIST allows OS- or app-level lock,
   but for a remote web session accessing CUI the **application** must implement the
   lock/timeout (why DISA STIG puts it on the app). OS lock complements, doesn't
   replace.
7. **How to enforce absolute lifetime with JWT refresh?** Store session-start
   independently; force re-login past the cap regardless of refresh. See Pattern 5.
8. **Multi-tab?** BroadcastChannel / react-idle-timer cross-tab. See Pattern 6.

## Carbon-Specific Constraints (from the code)

Grounded in `packages/auth/src/services/{session,auth,mfa}.server.ts`,
`packages/auth/src/types.ts`, the ERP/MES `x+/_layout.tsx` shells, and
`supabase/config.toml`.

1. **Session = signed react-router cookie wrapping GoTrue JWTs** — no server-side
   session store. `AuthSession` (`types.ts:3-19`) carries `accessToken`,
   `refreshToken`, `userId`, `companyId`, `expiresIn`, `expiresAt`, `mfaVerified` —
   **no `createdAt`/`lastActiveAt`**. Both timeouts require adding timestamp fields
   and stamping them on the login/MFA/refresh mint paths.
2. **`expiresAt`/`expiresIn` track only JWT expiry (≤50 min) and `refreshAuthSession`
   silently rotates tokens** (`session.server.ts:319-370`) — token expiry cannot
   stand in for session age. Absolute age must be tracked independently or it resets
   on every refresh. Refresh only preserves `console`/`mfaVerified`
   (`session.server.ts:332-337`) — added stamps need explicit preserve/update.
3. **`requireAuthSession` (`session.server.ts:285-317`) is the one always-run choke
   point** — called by `requirePermissions` (`auth.server.ts:332`) on every
   authenticated leaf loader/action. It already computes expiry and can
   `throw redirect`. This is where server-authoritative idle/absolute checks belong.
4. **The API-key path never validates a session** (`auth.server.ts:219-330`) — a
   timeout gate must sit on the session path only (machine callers are exempt by
   nature).
5. **The shell loader is skipped on search-param-only navigations**
   (`x+/_layout.tsx:84-114` `shouldRevalidate`) — a gate placed *only* in the shell
   misses cheap same-pathname navigations/realtime revalidations. Put enforcement in
   `requireAuthSession`; use the shell only for the blocking lock *screen*.
6. **MFA gives the unlock precedent.** `/mfa` (`_public+/mfa.tsx`) +
   `completeMfaChallenge` (`session.server.ts:138-202`) re-establish trust by
   **rotating tokens in the existing `carbon` cookie without destroying it** — the
   only existing "re-auth into an existing session" flow. The pending-MFA state uses
   a **separate cookie key** (`MFA_SESSION_KEY = "mfa"`) to represent
   "authenticated-but-must-complete-a-challenge" — the same shape a lock state can use.
7. **`requireMfa`-under-CONTROLLED_ENVIRONMENT is the exact pattern to mirror.** ERP
   shell: `const mfaRequired = CONTROLLED_ENVIRONMENT || companySettings.requireMfa`
   → server-decided flag → **blocking screen `MfaEnrollmentRequired` rendered in
   place of the shell `Outlet`, never a redirect** (`x+/_layout.tsx:249-257,
   393-411`). MES mirrors it with a console exemption. `userHasVerifiedTotpFactor`
   **fails closed** under `CONTROLLED_ENVIRONMENT` (`mfa.server.ts:96`). The lock
   screen mirrors this blocking-screen shape (so escape-hatch API routes stay
   reachable).
8. **Client scaffolding exists but no idle detection.** `CarbonProvider`
   (`provider.tsx`) has a `visibilitychange` refresh hook (`:63-85`) and a 60s
   `useInterval` that reloads once `expiresAt` passes (`:87-105`) — reusable hooks —
   but **no `react-idle-timer`** and no lock overlay. `@carbon/react` has
   `Modal`/`Drawer`; the strongest lock precedent is the MFA/ITAR blocking screen.
9. **Supabase does not enforce anything here.** `config.toml`: `jwt_expiry = 3000`
   (50 min), refresh rotation on, reuse interval 10s; **no timebox/inactivity_timeout
   set** (those are Pro-tier and only bite at the refresh boundary anyway). Clients
   are `autoRefreshToken:false, persistSession:false` — the app cookie is the sole
   session authority. So the app owns idle + absolute enforcement entirely.
10. **Current outer bound is a rolling 7-day cookie `maxAge`** (`SESSION_MAX_AGE`,
    re-committed on every `setAuthSession`) — a client-side rolling lifetime, not a
    server-enforced absolute cap.

## Recommended Approach for Carbon (feeds the spec)

Follows the layered model (OWASP/HIPAA) mirrored onto Carbon's MFA pattern:

1. **Gate on `CONTROLLED_ENVIRONMENT`** (optionally OR a future
   `companySettings.sessionTimeout` opt-in, mirroring `requireMfa`). Non-controlled
   deployments keep today's behavior.
2. **Add `createdAt` (session start) and `lastActiveAt` to `AuthSession`**; stamp
   `createdAt` at login/MFA mint (preserve across refresh), update `lastActiveAt` on
   activity. These are the two facts server enforcement needs.
3. **Server-authoritative enforcement in `requireAuthSession`** (the always-run
   point):
   - **Idle termination (3.1.11)**: `now - lastActiveAt > IDLE_LIMIT` (default 15
     min) → terminate the session (full logout) → redirect to login. This is the
     hard boundary.
   - **Absolute termination (3.1.11)**: `now - createdAt > ABSOLUTE_LIMIT` (default
     ~12h) → terminate → full re-login. Independent of refresh.
4. **Session lock (3.1.10) as the UX layer that satisfies pattern-hiding + re-auth**:
   a client idle detector (react-idle-timer, cross-tab) shows a **warning** near the
   idle limit, then a **full-screen lock overlay** (blocking-screen pattern, content
   removed from view). Unlock = **re-authenticate** via the MFA-style token-rotation
   flow into the *same* cookie when still within the server idle window; if the
   server idle/absolute limit already passed, the server has terminated it and the
   overlay's unlock falls through to full login.
   - Decision to resolve in the spec: lock-then-terminate (grace: lock at 15 min,
     terminate at e.g. 15 min + short grace) vs terminate-at-idle-with-lock-as-warning.
     NIST wants *both* a lock and a termination, so the clean model is **lock at the
     idle threshold, terminate at idle+grace and at the absolute cap**.
5. **Configurable, documented values** as named constants (like MFA/`CONTROLLED_
   ENVIRONMENT`), defaults idle 15 min / absolute 12h / warning at ~13 min — recorded
   in the security plan.
6. **Reuse, don't reinvent**: unlock via the `completeMfaChallenge`
   token-rotation-in-place mechanism; lock screen via the MFA/ITAR blocking-screen
   shape; client timers via the existing `CarbonProvider` interval/visibility hooks +
   react-idle-timer.

## Open Questions to carry into the spec

- **Idle → lock vs idle → terminate**: does the idle threshold *lock* (re-auth to
  resume, session preserved) with a separate longer *terminate*, or terminate at
  idle with the lock as a pre-warning? (NIST wants both a lock and a termination —
  recommend lock at threshold, terminate at threshold+grace and at absolute cap.)
- **Unlock credential**: MFA/TOTP re-challenge (reuses `completeMfaChallenge`
  cleanly, but only users with a factor) vs a password/magic-link re-auth vs
  passkey. What is the unlock proof for a controlled-env user (who is MFA-enrolled
  by force anyway)?
- **Configurability**: fixed policy constants vs per-company admin settings (like
  `requireMfa`). Controlled-env forces on regardless.
- **Exact defaults**: idle 15 min (DISA) confirmed? absolute 8h vs 12h (OWASP vs
  AWS)? warning lead time?
- **MES shop-floor exemption**: console/kiosk mode is MFA-exempt today
  (`mes x+/_layout.tsx:177-182`). Does idle-lock apply to console/kiosk sessions, or
  are shared shop-floor stations exempt/handled differently?
- **Scope of enforcement point**: `requireAuthSession` covers ERP + MES leaf loaders
  and API (non-key) routes uniformly — confirm that's the intended blast radius.

## Sources

- https://csf.tools/reference/nist-sp-800-53/r5/ac/ac-11/
- https://csf.tools/reference/nist-sp-800-53/r5/ac/ac-12/
- https://csf.tools/reference/nist-sp-800-171/r2/3-1/3-1-10/
- https://csf.tools/reference/nist-sp-800-171/r2/3-1/3-1-11/
- https://csf.tools/reference/nist-sp-800-171/r3-0/03-01/03-01-10/
- https://grcacademy.io/cmmc/controls/ac-l2-3-1-10/
- https://redspin.com/blog/commonly-confused-nist-sp-800-171-requirements/
- https://dodcio.defense.gov/Portals/0/Documents/CMMC/AssessmentGuideL2v2.pdf
- https://www.stigviewer.com/stig/application_security_and_development/ (rule V-222389, 15 min)
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://owasp-aasvs.readthedocs.io/en/latest/requirement-3.3.html
- https://supabase.com/docs/guides/auth/sessions
- https://idletimer.dev/docs/features/cross-tab
- https://www.npmjs.com/package/react-idle-timer
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_update-role-settings.html
- https://help.salesforce.com/s/articleView?id=sf.security_overview_sessions.htm
- https://www.accountablehq.com/post/hipaa-automatic-logoff-requirements-and-best-practices
- https://guptadeepak.com/ciam-compass/guides/token-lifetime-best-practices/
