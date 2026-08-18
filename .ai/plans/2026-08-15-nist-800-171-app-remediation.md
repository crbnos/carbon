# NIST SP 800-171 — Carbon Application Remediation Plan

Status: **MOSTLY IMPLEMENTED** — audited 2026-08-18. Most Phase 1/2/4 [app] items
landed on branch `nist-800-110-audit`; this file now tracks **only the residual
TODOs**. The completed sub-efforts have their own spec+plan under
`.ai/specs/implemented/` and `.ai/plans/implemented/` (indexed below).

The Carbon-repo half of a two-repo effort. The infrastructure/chart half and the
full 110-control gap assessment live in the **helm** repo
(`helm/niamey/docs/nist-800-171-audit.md` and `.../nist-800-171-remediation-plan.md`).
This plan covers only the items tagged **[app]** there.

Guiding decision unchanged: **`CONTROLLED_ENVIRONMENT` is the CUI switch** — every
hardening keys off it the way MFA enforcement does (on and non-overridable when
true, opt-in otherwise). No new global flags.

---

## Completed (implemented on branch — moved to `implemented/`)

Verified against code + commits during the 2026-08-18 audit.

| Item | Control | Evidence (commit / file) |
|------|---------|--------------------------|
| **TOTP MFA foundation** | 3.5.3 | `plans/implemented/2026-08-15-totp-mfa.md`; `mfa.server.ts`, `/mfa` routes, enrollment in `account+/security.tsx`, admin reset |
| **Session lock + termination** (2.2/2.3) | 3.1.10 / 3.1.11 | `specs+plans/implemented/2026-08-17-session-lock-timeout.md`; commits `c76e15e4c`→`c7a076477` (env clocks, `AuthSession` clocks, `requireAuthSession` enforcement, heartbeat, `/unlock`, `useIdle`, `SessionLockOverlay`, console idle-lock) |
| **Remove `"0"` permission wildcard** (2.8) | 3.1.5 | `specs+plans/implemented/2026-08-16-remove-global-permission-wildcard.md`; commit `0cbaf1390` (verified in browser `ba340f2d9`) |
| **Integration secrets → Supabase Vault** (1C.1) | 3.13.16 / SC-28 | `specs/implemented/2026-08-15-…` + `plans/implemented/2026-08-16-integration-secret-encryption.md`; `packages/ee/src/integrations/secrets.ts`, migration `20260817122916_integration-secret-vault.sql`; commits `a21c1840d`,`497ca158d`,`7fc7f26aa`,`ef6116975` |
| **Backfill + scrub plaintext secrets** (1C.2) | 3.13.16 | `packages/jobs/src/scripts/backfill-integration-secrets.ts` + migration `20260817130939_scrub-integration-plaintext-secrets.sql` (0 plaintext remain); commits `96f2e1cca`,`fa9c10928` |
| **Constant-time webhook HMAC** (1C.3) | 3.13.x | commit `add16f739` (paperless-parts → `timingSafeEqual`) |
| **Capture auth events** (1A.1 app) | 3.3.1/3.3.2 | `packages/auth/src/services/auth-events.server.ts`; commits `52cb260d5`,`dc3c55f71` — emits login_success/failed/rate_limited, magic_link_sent, mfa_challenge_*, permission_denied |
| **Audit permission-denied** (1A.3) | 3.1.7 | `auth.server.ts:394` `logAuthEvent("permission_denied", …)` |
| **Audit on-by-default + locked under CUI** (1A.4) | 3.3.1 | commit `3393d5404` |
| **Append-only audit tables** (1B.1) | 3.3.8 / AU-9 | commit `f0ec59811` |
| **Audit retention ≥ 1 year** (1B.2) | 3.3.1 | `audit-archive.ts` floors hot window at 365d under CUI |
| **MFA fail-closed under CUI** (2.4) | 3.5.3 | commit `add16f739` (`userHasVerifiedTotpFactor` denies on backend error under CUI) |
| **Consent-to-monitoring banner** (2.7) | 3.1.9 | MET — `ItarLoginDisclaimer` on ERP+MES login under CUI (no code change) |
| **Deepen `/health`** (4.2) | 3.14.6 | Redis + DB probes, 2s timeout, always-200 body-status |
| **Error-detail leak fix** (4.4) | SI-11 | commit `add16f739` (stack/message gated behind DEV; prod shows requestId) |
| **Analytics inert under CUI** (4.5) | 3.4.6 | `entry.client.tsx` boot assertion refuses to boot if PostHog loads under CUI |

Bonus authz fix on-branch: `15545ecee` — `is_claims_admin` checked the reversed
permission (`users_update` vs `update_users`).

---

## Remaining TODOs [app]

### 1A.2 — Permission/role-change audit events — 3.3.1/3.3.2 — **OPEN**

The mutation paths write permission/membership changes but emit **no** audit event.
`packages/auth/src/services/users.server.ts` (`deactivateEmployee/Customer/Supplier/User`)
writes `userPermission`, deletes `userToCompany`, flips `employee.active`, deletes
`employeeJob` — and only invalidates the Redis cache, never emits. ERP routes
`x+/users+/deactivate.tsx` and `x+/users+/bulk-edit-permissions.tsx` and their batch
jobs (`tasks/update-permissions.ts`, `tasks/user-admin.ts`) are equally silent.

- **Approach:** emit an audit entry (actor, target user, before/after permission set,
  companyId) on writes to `userPermission`/`employeeTypePermission`/`userToCompany` and
  the deactivation flows. Reuse `logAuthEvent` (add `permission_changed`/`role_changed`
  to the `AuthEvent` union in `auth-events.server.ts`) OR the existing
  `insert_audit_log_batch` RPC shape. Service-role writes currently set `actorId := NULL`
  — thread the acting `userId` through so the actor is recorded.
- **Verify:** grant then revoke a permission and deactivate a user; confirm each produces
  an event with actor + target + before/after.

### 2.1 — Per-account failed-login lockout — 3.1.8 — **OPEN**

Both ERP (`_public+/login.tsx:96-110`) and MES logins rate-limit by **IP only**
(`Ratelimit.slidingWindow(RATE_LIMIT, "1 h")`, key = `ip`). No email-keyed counter,
no per-account backoff/lock.

- **Approach:** add an email-keyed counter in `@carbon/kv` (`Ratelimit`/token bucket)
  with exponential backoff + temporary lock; emit a `login_locked`/`lockout` auth event
  (also closes the "no lockout event" gap in 1A.1). Mirror in MES login.
- Note: magic-link is passwordless, so this guards enumeration/abuse rather than
  password guessing — but 3.1.8 asks for the account-scoped limit explicitly.
- **Verify:** N failed sends for one email locks that email (not just the IP).

### 2.6 — Auto-disable inactive accounts — 3.5.6 — **OPEN**

No scheduled job deactivates idle accounts (confirmed: none of the crons in
`packages/jobs/src/inngest/functions/scheduled/` read `user.active`/last-sign-in).

- **Approach:** scheduled Inngest job deactivating accounts idle > N days (last-login
  from `auth.audit_log_entries`); reuse `deactivateEmployee` et al. On deactivation,
  scrub residual `userId` references noted in
  `.claude/rules/user-employee-job-relationships.md`.
- **Verify:** an account idle past the threshold is auto-deactivated by the job.

### 4.3 — File-upload validation — 3.14.2/3.7.4 — **OPEN** (size limits partial)

Only `private` (50 MB) and `temp-staging` (2.5 GB) buckets have `file_size_limit`
(`20260715150742_temp-staging-bucket.sql`); `public`/`avatars`/`company-templates`/
feedback have none. **No** bucket sets `allowed_mime_types` (zero hits repo-wide), and
there is **no** server-side magic-byte check — the serve route
`file+/preview+/$bucket.$.tsx` maps `Content-Type` from the file **extension** only.

- **Approach:** set `allowed_mime_types` + `file_size_limit` on every bucket (migrations);
  add a server-side magic-byte check (`file-type`/`fileTypeFromBuffer`) on the upload
  path, not just the serve-time extension map. Quarantine-on-hit handling is app-side;
  the AV scan (ClamAV/Lambda on `private`) is **[chart]**.
- **Verify:** oversized / wrong-MIME / spoofed-extension upload is rejected.

### 4.1 — Security monitoring hooks (app side) — 3.14.6/3.14.7 — **PARTIAL**

App-side structured logging is **done**: `logAuthEvent` (failed-login, rate-limited,
permission-denied) and `entry.server.tsx handleError` (5xx with requestId) ship JSONL
to stdout via `@carbon/logger` with stable `authEvent`/`error` fields for downstream
metric filters. **Remaining app decision:** whether to add self-hosted Sentry **or** an
OTel exporter in-code (currently a console-only sink; adding one is a deploy-shape change
per `packages/logger` AGENTS.md). The CloudWatch log group + metric filters + alarms are
**[chart]** (helm). Decide: metric-filters-from-logs (no app change) vs. in-app exporter.

### 2.5 — Password grant under CUI — 3.5.7/3.5.8/3.5.9 — **MET by architecture** (optional hardening)

There is **no `password` provider anywhere** — `AuthProvider` is
`email|google|azure|passkey`, primary flow is magic-link, and there is no
`signInWithPassword`/reset route to reach. The control is satisfied by architecture, not
by a CUI-conditional 404. **Optional:** add an explicit `CONTROLLED_ENVIRONMENT` assertion
that `AUTH_PROVIDERS` excludes `password` (defense-in-depth against a future regression).
Low priority — arguably a no-op today.

---

## Residuals on completed items (small, non-blocking)

- **1A.1 parity:** the `logout` event is defined in the `AuthEvent` union but **never
  emitted**; **MES login** does not call `logAuthEvent` at all (ERP-only today). Wire both
  for full coverage.
- **Session lock browser verification:** the session-lock plan's last task (browser
  verify via `/test`) is unrun. It now also covers this session's **passkey-unlock**
  addition and the **MES passkey login** backend — see "This session (uncommitted)" below.
- **1C deploy ordering:** the backfill is a **manual script**, the scrub is an
  **auto-applied migration** sorting after it. Correct deploy order: vault migration →
  run `backfill-integration-secrets.ts` → scrub migration. If scrub runs first it's a
  harmless no-op (secretRef still NULL), but secret-bearing integrations then throw
  `IntegrationSecretUnavailableError` on read until the backfill runs or the integration
  is re-saved. Capture as a runbook/POAM note in helm; also fix the stale
  "transitional read-fallback" comment in the backfill script header (the fallback was
  removed from `resolveIntegrationSecrets`).

---

## Newly found during the 2026-08-18 audit (not in the original plan)

### N1 — Console PIN stored/compared in plaintext — 3.5.10 — **OPEN**

`apps/mes/app/routes/x+/console.pin-in.tsx` verifies the operator PIN with a plaintext
equality check (`pin !== storedPin`) against `employee.pin`, which is stored in the
clear. 3.5.10 requires authenticators to be stored cryptographically-protected.

- **Approach:** hash the PIN at rest (salted; argon2/bcrypt, or at minimum SHA-256+salt)
  and compare with a constant-time check; update the write path where `employee.pin` is
  set (employee form / console setup) and a one-time migration to hash existing PINs (or
  force re-set). Distinct from passkeys — it's the shared-kiosk factor.

### N2 — Passkey assurance posture for CUI — 3.13.11 / 3.5.3 (AAL) — **DECISION (POA&M)**

Passkey registration uses `attestationType:"none"` and allows **syncable** authenticators
(iCloud Keychain / Google Password Manager), and `authenticatorAttachment:"platform"`
excludes roaming FIDO2 hardware keys. This is fine for **AAL2** (passkey + user
verification = MFA, replay-resistant) but cannot *prove* device-bound/AAL3 or FIPS-140
crypto to a strict assessor.

- **Decision needed (not necessarily code):** either (a) document a risk acceptance that
  passkeys operate at AAL2 for the CUI boundary, or (b) tighten — `attestation:"direct"`
  + an approved-AAGUID allowlist (record the `aaguid`, which is already stored) and allow
  cross-platform authenticators — if an AAL3/hardware-key requirement lands. Confirm the
  deployment's crypto module FIPS-140 posture (3.13.11) for auth.

---

## This session (uncommitted — commit + verify before it counts)

Extends 2.3 and broadens passkey coverage; **not yet committed, not browser-verified**:

- **Passkey session-lock unlock** (ERP + MES) — `/unlock` JSON branch resumes the locked
  session in place (rejects a passkey whose `userId` ≠ the locked session's), + overlay
  and full-page buttons.
- **MES passkey login backend** — `apps/mes/app/routes/api+/passkey.authenticate.{options,verify}.ts`
  (previously the MES client called endpoints that did not exist — MES passkey login was
  non-functional).
- **`AUTH_PROVIDERS` now includes `passkey`** in `.env`; **Account → Security** list UI
  full-width fix; **i18n** wrapped + all locales filled.
- **TODO:** commit these; run a WebAuthn verification pass (virtual authenticator or
  manual) covering passkey **register → login → unlock** on both apps — this is the
  outstanding "Task 10" browser proof.

---

## Not in this repo (tracked in helm/niamey)

Pod `securityContext`, in-cluster mTLS, S3 Object Lock (audit-archive immutability),
blocking CI scans + SAST + secret-scan + SBOM/signing, CloudWatch alarms/dashboards +
metric filters, GoTrue log shipping (fluent-bit, `SB_FORWARDED_FOR`), AV scanning, the CI
OIDC/ARC cutover, and all Phase-5 program artifacts (SSP, POA&M, IR plan, ConMon,
inheritance statements). See `helm/niamey/docs/nist-800-171-remediation-plan.md`.

## Suggested order for the residual

1. Quick, self-contained: **N1** (hash console PIN), **1A.1 parity** (logout + MES event),
   **1C** stale-comment fix, **2.5** assertion.
2. Data-model: **1A.2** (permission/role audit — migration or event emission).
3. Identity: **2.1** (account lockout), **2.6** (auto-disable inactive).
4. Integrity/monitoring: **4.3** (upload validation), **4.1** (exporter decision).
5. Governance: **N2** passkey AAL risk-acceptance (POA&M) — no code unless AAL3 required.
6. **Commit + WebAuthn-verify this session's passkey work.**
