# NIST SP 800-171 — Carbon Application Remediation Plan

Status: **MOSTLY IMPLEMENTED** — last synced 2026-08-18. Branch `nist-800-110-audit`
is **up to date with `origin/main`** (merged at `3f89af06e`; 43 ahead / 0 behind) and
carries the NIST [app] work. This file tracks **only the residual TODOs**; completed
sub-efforts have their own spec+plan under `.ai/specs/implemented/` and
`.ai/plans/implemented/` (indexed below).

The Carbon-repo half of a two-repo effort. The infrastructure/chart half and the
full 110-control gap assessment live in the **helm** repo
(`helm/niamey/docs/nist-800-171-audit.md` and `.../nist-800-171-remediation-plan.md`).
This plan covers only the items tagged **[app]** there.

Guiding decision unchanged: **`CONTROLLED_ENVIRONMENT` is the CUI switch** — every
hardening keys off it the way MFA enforcement does (on and non-overridable when
true, opt-in otherwise). No new global flags.

---

## Completed (on branch)

Verified against code + commits. Sub-efforts with their own docs are linked.

| Item | Control | Evidence (commit / PR / file) |
|------|---------|--------------------------|
| **TOTP MFA foundation** | 3.5.3 | `plans/implemented/2026-08-15-totp-mfa.md`; `mfa.server.ts`, `/mfa` routes, enrollment in `account+/security.tsx` |
| **Session lock + termination** (2.2/2.3) | 3.1.10 / 3.1.11 | `specs+plans/implemented/2026-08-17-session-lock-timeout.md`; commits `c76e15e4c`→`c7a076477` |
| **Passkey session-lock unlock + MES passkey login** | 3.1.10 / 3.5.3 | commit `e9636bb0e` — `/unlock` passkey branch (ERP+MES, resumes in place, rejects mismatched userId); MES `api+/passkey.authenticate.{options,verify}.ts` (were missing); `AUTH_PROVIDERS` gained `passkey`; Account→Security UI + i18n (`c4c75df34`). **Residual: WebAuthn browser proof** (below) |
| **Remove `"0"` permission wildcard** (2.8) | 3.1.5 | `specs+plans/implemented/2026-08-16-remove-global-permission-wildcard.md`; commit `0cbaf1390` (verified in browser `ba340f2d9`); `owner.test.ts` reconciled |
| **Integration secrets → Supabase Vault** (1C.1) | 3.13.16 / SC-28 | `specs+plans/implemented/…-integration-secret-encryption.md`; `packages/ee/src/integrations/secrets.ts`, migration `20260817122916_integration-secret-vault.sql`; commits `a21c1840d`,`497ca158d`,`7fc7f26aa`,`ef6116975` |
| **Backfill + scrub plaintext secrets** (1C.2) | 3.13.16 | **consolidated** into one idempotent, auto-applied migration `20260817132607_backfill-and-scrub-integration-secrets.sql` (vault-move + strip in one pass; RAISEs on an unmapped secret). The old split (manual script + separate scrub migration) was deleted — closes the deploy-ordering hazard |
| **Constant-time webhook HMAC** (1C.3) | 3.13.x | commit `add16f739` (paperless-parts → `timingSafeEqual`) |
| **Capture auth events** (1A.1 app) | 3.3.1/3.3.2 | `packages/auth/src/services/auth-events.server.ts`; commits `52cb260d5`,`dc3c55f71` — login_success/failed/rate_limited, magic_link_sent, mfa_challenge_*, permission_denied, **login_locked**. *(Residual: `logout` + MES-login parity, below)* |
| **Permission/role-change audit events** (1A.2) | 3.3.1/3.3.2 | **PR #1424, merged (`dbe4db3f2`)** — `permission_changed`/`role_changed` + actor threading from `users.server.ts` deactivate flows, `update-permissions` job, ERP permission routes. Run record `.ai/runs/2026-08-18-nist-1a2-permission-audit.md` |
| **Audit permission-denied** (1A.3) | 3.1.7 | `auth.server.ts` `logAuthEvent("permission_denied", …)` |
| **Audit on-by-default + locked under CUI** (1A.4) | 3.3.1 | commit `3393d5404` |
| **Append-only audit tables** (1B.1) | 3.3.8 / AU-9 | commit `f0ec59811` |
| **Audit retention ≥ 1 year** (1B.2) | 3.3.1 | `audit-archive.ts` floors hot window at 365d under CUI (`56d8a16e5`) |
| **Per-account failed-login lockout** (2.1) | 3.1.8 | **PR #1423, merged (`957a6866c`)** — `@carbon/kv` `lockout` module (email-keyed, exponential backoff, fails open), `login_locked` event, ERP+MES login + MES passkey reset. Run record `.ai/runs/2026-08-18-nist-2.1-login-lockout.md` |
| **MFA fail-closed under CUI** (2.4) | 3.5.3 | commit `add16f739` |
| **Consent-to-monitoring banner** (2.7) | 3.1.9 | MET — `ItarLoginDisclaimer` under CUI (no code) |
| **Deepen `/health`** (4.2) | 3.14.6 | Redis + DB probes, always-200 body-status (`56d8a16e5`) |
| **Error-detail leak fix** (4.4) | SI-11 | commit `add16f739` |
| **Analytics inert under CUI** (4.5) | 3.4.6 | boot assertion in `entry.client.tsx` (`56d8a16e5`) |

Bonus authz fix: `15545ecee` — `is_claims_admin` checked the reversed permission.

---

## Deferred (implemented, NOT merged into this branch)

### 2.6 — Auto-disable inactive accounts — 3.5.6 — **DONE on PR #1425, DEFERRED**

Implemented and green on **PR #1425** (`feat/nist-2.6-inactive-account-disable`) — a
`disable-inactive-accounts` step in the existing `scheduled/cleanup.ts` (gated on
`CONTROLLED_ENVIRONMENT`, idle > 35d from `auth.audit_log_entries`, reuses
`deactivateUser`, scrubs residual `userId` refs, emits `account_auto_deactivated`).
The PR is CLEAN/MERGEABLE and rebased onto the current HEAD, but **out of scope for
this branch — not being merged now**. Land it separately when 2.6 is in scope.

---

## Remaining TODOs [app]

### 4.3 — File-upload validation — 3.14.2/3.7.4 — **OPEN** (size limits partial)

Only `private` (50 MB) and `temp-staging` (2.5 GB) buckets have `file_size_limit`;
`public`/`avatars`/`company-templates`/feedback have none. **No** bucket sets
`allowed_mime_types`, and there is **no** server-side magic-byte check — the serve
route `file+/preview+/$bucket.$.tsx` maps `Content-Type` from the file **extension**.

- **Approach:** set `allowed_mime_types` + `file_size_limit` on every bucket (migrations);
  add a server-side magic-byte check (`file-type`/`fileTypeFromBuffer`) on upload.
  Quarantine-on-hit is app-side; the AV scan (ClamAV/Lambda) is **[chart]**.
- **Verify:** oversized / wrong-MIME / spoofed-extension upload is rejected.

### 4.1 — Security monitoring hooks (app side) — 3.14.6/3.14.7 — **PARTIAL**

App-side structured logging is **done** (`logAuthEvent` + `entry.server.tsx handleError`
ship JSONL with stable `authEvent`/`error` fields). **Remaining app decision:** add a
self-hosted Sentry **or** an OTel exporter in-code (currently console-only sink), OR
derive metrics downstream from the logs. CloudWatch log group + metric filters + alarms
are **[chart]** (helm).

### 2.5 — Password grant under CUI — 3.5.7/3.5.8/3.5.9 — **MET by architecture** (optional)

No `password` provider exists — `AuthProvider` is `email|google|azure|passkey`, magic-link
is primary, no `signInWithPassword`/reset route to reach. **Optional:** a
`CONTROLLED_ENVIRONMENT` assertion that `AUTH_PROVIDERS` excludes `password`
(defense-in-depth). Low priority — a no-op today.

### N1 — Console PIN stored/compared in plaintext — 3.5.10 — **OPEN** (found in audit)

`apps/mes/app/routes/x+/console.pin-in.tsx` verifies the operator PIN with a plaintext
`pin !== storedPin` against `employee.pin` (stored in the clear).

- **Approach:** hash the PIN at rest (salted argon2/bcrypt, or SHA-256+salt) + constant-time
  compare; update the write path (`employee.pin`) and a migration to hash existing PINs (or
  force re-set). Distinct from passkeys — the shared-kiosk factor.

### N2 — Passkey assurance posture for CUI — 3.13.11 / 3.5.3 (AAL) — **DECISION (POA&M)**

Registration uses `attestationType:"none"` and allows **syncable** authenticators, and
`authenticatorAttachment:"platform"` excludes roaming FIDO2 keys — fine for **AAL2** but
not provably AAL3/FIPS-140.

- **Decision (not necessarily code):** (a) document a risk acceptance that passkeys operate
  at AAL2 for the CUI boundary, or (b) tighten (`attestation:"direct"` + approved-AAGUID
  allowlist + cross-platform authenticators) if AAL3/hardware-keys are required. Confirm
  the deployment's FIPS-140 crypto posture.

---

## Residuals on completed items (small, non-blocking)

- **1A.1 parity:** the `logout` event is defined but **never emitted**; **MES login** does
  not call `logAuthEvent` (ERP-only). `login_locked` is now emitted (via 2.1). Wire logout +
  MES for full coverage.
- **Passkey / session-lock browser verification:** WebAuthn can't run headless, so the
  passkey **register → login → unlock** flow on both apps is unproven (the session-lock
  plan's last "Task 10"). Needs a virtual-authenticator or manual pass before it counts as
  verified.

---

## Not in this repo (tracked in helm/niamey)

Pod `securityContext`, in-cluster mTLS, S3 Object Lock (audit-archive immutability),
blocking CI scans + SAST + secret-scan + SBOM/signing, CloudWatch alarms/dashboards +
metric filters, GoTrue log shipping (fluent-bit, `SB_FORWARDED_FOR`), AV scanning, the CI
OIDC/ARC cutover, and all Phase-5 program artifacts (SSP, POA&M, IR plan, ConMon,
inheritance statements). See `helm/niamey/docs/nist-800-171-remediation-plan.md`.

## Suggested order for the residual

1. Quick, self-contained: **N1** (hash console PIN), **1A.1 parity** (logout + MES event),
   **2.5** assertion.
2. Integrity/monitoring: **4.3** (upload validation), **4.1** (exporter decision).
3. Governance: **N2** passkey AAL risk-acceptance (POA&M) — no code unless AAL3 required.
4. Verification: WebAuthn browser proof of the passkey register→login→unlock flow.
5. When back in scope: land **PR #1425** (2.6 auto-disable inactive accounts).
