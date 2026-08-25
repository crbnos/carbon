# Feature run: Session lock/timeout under CUI (NIST 800-171 3.1.10 / 3.1.11)

- Date: 2026-08-17
- Mode: approval-per-phase
- Request: "let's get started on session/lock timeout. treat this like a /feature" —
  Session lock/timeout under CUI for NIST 800-171 3.1.10 (session lock) and 3.1.11
  (session termination): controlled-environment idle lock + absolute session
  termination, mirroring the existing requireMfa / CONTROLLED_ENVIRONMENT gating.
- Phase plan: research [run — security-critical, implementation model is open] ·
  spec [run — touches auth/session, security contract, will have OQs] · plan [run] ·
  execute [run] · test [run — user-facing lock/re-auth flow] · self-review [run]

## Decisions
Steer from user: "as lenient as humanly possible while still remaining compliant."
Open Questions resolved (approval mode, human-decided) — 2026-08-17:
- OQ1 idle behavior: **idle → resumable LOCK only** (session preserved, re-auth to
  resume, no idle-logout). 3.1.10 satisfied by the lock; 3.1.11 satisfied by the
  ABSOLUTE cap + explicit logout (inactivity-termination is an NIST example, not a
  mandate). Most lenient compliant split.
- OQ2/OQ5 unlock credential: **console mode → PIN; all other (ERP + non-console MES)
  → TOTP re-challenge** via completeMfaChallenge rotation. (User: "for the MES — pin
  unlock in console mode — totp if not.")
- OQ3 config: **force-on under CONTROLLED_ENVIRONMENT only**; non-controlled
  deployments unaffected (mirror requireMfa).
- OQ4 defaults: idle-lock **15 min** (DISA web-app ceiling), absolute cap **12h**
  (AWS workday). Pre-lock warning modal OPTIONAL (lock is now non-destructive).
- OQ6 blast radius: enforce in **requireAuthSession** (ERP+MES interactive sessions);
  **API-key machine callers exempt**.
- NEW (surfaced in spec design) — MES console device absolute cap: **A, exempt the
  console DEVICE login from the 12h absolute termination**; console "lock" = existing
  pin-in dropping to re-PIN, tightened to 15 min under CONTROLLED_ENVIRONMENT. ERP +
  non-console MES get full model (15-min TOTP lock + 12h absolute termination).
  (User: "a".)
- Design-settled (codebase precedent, documented in spec, not user-gated):
  activity signal = throttled CLIENT heartbeat (not server request-time, which the
  60s CarbonProvider poll + realtime revalidations would falsely register as active);
  createdAt/lastActiveAt live in the signed session cookie; unlock via dedicated
  /unlock route; NO new dependency — small in-house useIdle hook + BroadcastChannel
  (respects ask-first-on-deps).

## Phase log
- research: DONE → .ai/research/session-lock-timeout.md (NIST/CMMC + OWASP/apps + Carbon code, 3 subagents). Key: lock (3.1.10) ≠ termination (3.1.11), both required; 15-min idle (DISA), ~8–12h absolute (OWASP/AWS); server-authoritative in requireAuthSession; add createdAt/lastActiveAt to AuthSession; unlock via MFA token-rotation precedent; mirror requireMfa/CONTROLLED_ENVIRONMENT blocking-screen.
- spec: DONE → .ai/specs/2026-08-17-session-lock-timeout.md (all 6 OQs + 1 new OQ
  resolved with user before writing; 11 design decisions D1–D11; no migration —
  two optional AuthSession cookie fields).
- plan: DONE → .ai/plans/2026-08-17-session-lock-timeout.md (10 tasks). 🛑 plan-approved
  by user 2026-08-17 ("/execute"). Task 8 v1 confirmed: overlay conceals + funnels to
  /unlock (OTP form on the route, not embedded) — pending any user tweak.
- Set CONTROLLED_ENVIRONMENT=true in .env (gitignored; line 114) so the gated feature
  is testable in Task 10 (needs dev-server reboot to take effect).
- execute: Tasks 1–9 DONE + committed (c76e15e4c, 2c3337ee6, 9e47eaac6, 9fb42cbf3,
  db4a4cd5d, d66045d3b, 350236cb3, bb00c4dd8, 5939bb898). Typecheck (auth/env/erp/mes)
  green, lint green, 24 auth unit tests pass. Task 10 (browser /test) pending user go —
  needs stack reboot with CONTROLLED_ENVIRONMENT=true.
- (pending) test (Task 10) — user asked to surface before browser phase

## Outcome
- (pending)
