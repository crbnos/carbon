# NIST SP 800-171 — Carbon Application Remediation Plan

Status: PLANNED 2026-08-15

The Carbon-repo half of a two-repo effort. The infrastructure/chart half and the
full 110-control gap assessment live in the **helm** repo
(`helm/niamey/docs/nist-800-171-audit.md` and `.../nist-800-171-remediation-plan.md`).
This plan covers only the items tagged **[app]** there — the code that must change
in `crbnos/carbon` for a CUI-handling GovCloud deployment to pass an 800-171
assessment.

Builds directly on the TOTP MFA work (`.ai/plans/2026-08-15-totp-mfa.md`) and reuses
its patterns: the `CONTROLLED_ENVIRONMENT` override, the blocking-gate shell pattern,
`completeMfaChallenge`/`requireAuthSession` in `session.server.ts`, and the
`companySettings` toggle precedent.

## Guiding decisions (resolve before building)

1. **`CONTROLLED_ENVIRONMENT` is the CUI switch.** Every hardening below keys off it
   the way MFA enforcement already does — on and non-overridable when true, opt-in
   otherwise. No new global flags.
2. **Password auth is dropped for CUI, not policy-hardened.** Magic-link/OAuth/passkey
   are already primary; removing `password` from `AUTH_PROVIDERS` under
   `CONTROLLED_ENVIRONMENT` moots 3.5.7/3.5.8/3.5.9 with near-zero code. (Chosen over
   building password complexity/history/rotation into GoTrue.)
3. **Integration secrets go to Supabase Vault**, not a new pgcrypto column scheme —
   `supabase_vault`/`pgsodium` are already preloaded by the postgres image.
4. **Auth events are captured by shipping GoTrue's existing `auth.audit_log_entries`**,
   not by re-instrumenting every login path. App-level emission is added only for
   permission/role changes and permission-denied events, which GoTrue can't see.

Open questions to confirm with Brad are marked **[OQ]**.

---

## Phase 1 — Audit accountability & secret confidentiality (P1)

### 1A. Capture authentication & authorization events — AU-2/AU-3 (3.3.1/3.3.2), 3.1.7

Today `auditLog_{companyId}` records only business-entity CRUD (`.claude/rules/audit-log-system.md`,
`packages/database/src/audit.config.ts`, `packages/jobs/src/inngest/functions/events/audit.ts`).
Missing: login, logout, failed login, MFA challenge, permission/role change,
permission-denied.

- **1A.1 Ship auth events to CloudWatch (RESOLVED 2026-08-15 → CloudWatch-only, "B").**
  Web-verified constraint (GoTrue source + supabase issues #2370/#42997): the
  `auth.audit_log_entries` **table** records ~24 *successful* actions (login, logout,
  token_refreshed, user_modified, factor challenge) with `actor_id`+`action`+
  `created_at`, but its `ip_address` is frequently EMPTY, `user_agent` is NOT
  persisted, and **failed logins are not recorded**. GoTrue's **stdout request logs**
  DO log every request incl. failures with `remote_addr`/`method`/`path`/`status`/
  `time`. So "action + timestamp + IP + outcome (incl. failures)" is a THREE-part DoD:
  1. **[chart]** ship BOTH `auth.audit_log_entries` AND the GoTrue request logs to
     CloudWatch via fluent-bit; set `GOTRUE_SECURITY_SB_FORWARDED_FOR_ENABLED=true`
     and have the proxy send the forwarded-for header (else IP stays empty).
  2. **[app]** Carbon emits its OWN structured auth events via `@carbon/logger`
     (already CloudWatch-shipped, redacted, request-id correlated) — the authoritative
     account+IP+outcome record that does not depend on GoTrue's flaky `ip_address`:
     login success/failure (`login.tsx`, already reads `x-forwarded-for`), per-account
     lockout (item 2.1), MFA challenge result (`session.server.ts`), permission-denied
     (item 1A.3).
  3. **[chart/prog]** documented CloudWatch retention (≥ contract), IAM-restricted log
     group, AU-5 failure alarm.
  - No `auth`-schema RPC and no in-app "Authentication tab" — that in-app option was
    REJECTED for compliance (add it later only as a product feature). Compliant because
    800-171's audit reviewers are the org's security staff (CloudWatch access), not
    per-tenant admins, and CloudWatch protection (KMS, IAM, out-of-band, non-mutable
    delivered events) is stronger than the in-app audit tables (which item 1B hardens).
    Sources: github.com/supabase/auth/issues/2370, supabase/supabase#42997.
- **1A.2 Emit permission/role-change events.** On writes to `userPermission`,
  `employeeTypePermission`, `userToCompany`, and the deactivation flows in
  `packages/auth/src/services/users.server.ts`, emit an audit entry (actor,
  target user, before/after permission set).
  - Approach: add these tables/operations to the audit config path, or emit
    explicitly from `users.server.ts` since permissions aren't a normal audited
    entity. Reuse the existing `insert_audit_log_batch` RPC shape.
- **1A.3 Audit permission-denied.** In `requirePermissions` (`auth.server.ts:382`),
  emit an audit/log event on the "Access Denied" branch (who, what route/permission,
  when). Wire to a CloudWatch metric for 4.1 alerting.
- **1A.4 On-by-default + non-disable under CUI.** Enable audit at company creation;
  under `CONTROLLED_ENVIRONMENT`, make `disableAuditLog` a no-op / hide the toggle
  (`enableAuditLog`/`disableAuditLog` in the audit service; company settings UI).

**Verify:** create a company under `CONTROLLED_ENVIRONMENT`; confirm audit is on and
cannot be turned off; produce one report showing a login, a failed login, an MFA
challenge, a permission grant, a denied access, and a record edit — each with actor,
timestamp, source IP.

### 1B. Audit tamper-evidence — AU-9 (3.3.8)

- **1B.1 Append-only tables.** Migration adding a trigger on `auditLog_*` that
  raises on `UPDATE`/`DELETE` unless the current role is the archive service role
  used by `delete_old_audit_logs`. Tighten the `USING true` RLS to read-gated by
  permission (`.claude/rules/audit-log-system.md` line 33 documents the current
  permissive policy).
  - Note: `auditLog_*` tables are created dynamically per company — the trigger
    must be attached by the same `enableAuditLog` path that creates the table, and
    backfilled onto existing ones by the migration.
- **1B.2 Retention ≥ 1 year.** Raise `retentionDays` (audit.config); archive
  (gzip → storage) already exists in `packages/jobs/src/inngest/functions/scheduled/audit-archive.ts`.
  Object Lock on the archive bucket is a **[chart]** item.

**Verify:** attempt `UPDATE`/`DELETE` on an `auditLog_*` row as a normal user →
rejected; archive job still succeeds.

### 1C. Encrypt integration secrets — SC-28 (3.13.16)

Xero/QBO/Jira/Linear/Slack/OnShape/exchange-rate credentials are stored **plaintext**
in `companyIntegration.metadata` (JSON column, `20240119095150_integrations.sql:28`),
read cleartext in `packages/ee/**` (e.g. `linear/lib/client.ts:33`,
`slack/lib/service.ts:227`, `accounting/core/models.ts:83`).

- **1C.1 Vault-backed storage.** Store credentials in `vault.secrets`; keep only a
  vault secret id in `metadata`. Add helpers `putIntegrationSecret`/`getIntegrationSecret`
  (service-role) and update every EE provider read path to resolve via vault.
  - Files: `packages/ee/src/**/lib/client.ts` (all providers),
    `packages/ee/src/accounting/core/models.ts`, integration install/config actions.
- **1C.2 Backfill + scrub.** One-time job to move existing plaintext metadata secrets
  into vault and null the plaintext fields. Idempotent (per migration-idempotency
  lesson).
- **1C.3 Constant-time HMAC.** `apps/erp/app/routes/api+/webhook.paperless-parts.$companyId.ts:98`
  uses `signature !== expectedSignature`; switch to `crypto.timingSafeEqual` (match
  the Xero webhook at `webhook.xero.ts:70`).

**Verify:** DB inspection shows no plaintext tokens in `companyIntegration.metadata`;
a Xero/QBO/Slack sync still authenticates end-to-end; Paperless webhook still accepts a
valid signature and rejects a bad one.

---

## Phase 2 — Identity & access hardening (P2)

- **2.1 Per-account failed-login lockout — 3.1.8.** The login send path
  (`apps/erp/app/routes/_public+/login.tsx:95`) rate-limits by IP only. Add an
  email-keyed counter in `@carbon/kv` (`Ratelimit`/token bucket) with exponential
  backoff + temporary lock; emit a metric for alerting. Mirror in MES login.
- **2.2 Session inactivity timeout — 3.1.11 / 3.13.9.** Track last-activity in
  `requireAuthSession` (`packages/auth/src/services/session.server.ts`); terminate/
  redirect after an idle threshold (CUI default 15–30 min). Make it a
  `companySettings` value, forced on under `CONTROLLED_ENVIRONMENT` (reuse the
  `requireMfa` settings precedent).
- **2.3 Session lock — 3.1.10 (RESOLVED 2026-08-15 → lock + terminate, BOTH, gated on
  `CONTROLLED_ENVIRONMENT`).** 3.1.10 (AC-11, session lock) and 3.1.11 (AC-12,
  termination) are DISTINCT controls, not alternatives — logout-on-idle satisfies
  3.1.11 but leaves 3.1.10 unmet, so we do both. **Lock** at a short idle threshold
  (CUI default ~15 min): client idle-detector → full-screen overlay that hides all
  content (pattern-hiding) and requires a re-challenge (passkey/TOTP/re-auth) to
  resume, session preserved — reuses the MFA challenge machinery. **Terminate**
  (item 2.2) at a longer hard bound → destroy session. **Both behaviors are gated on
  `CONTROLLED_ENVIRONMENT`** (off for normal deployments; on and non-overridable under
  controlled, per the `requireMfa` precedent) — acceptable because 800-171 applies
  only to the CUI/controlled boundary. Component under `apps/erp/app/components`; hook
  into the authenticated shell (`x+/_layout.tsx`). MET-s both 3.1.10 and 3.1.11 (no
  POA&M needed).
- **2.4 Close MFA fail-open — 3.5.3.** `userHasVerifiedTotpFactor`
  (`packages/auth/src/services/mfa.server.ts:64`) currently fails **open** on
  Redis/GoTrue error. Under `CONTROLLED_ENVIRONMENT`, fail **closed** (deny → `/mfa`
  or hard error). Extend `mfa-session.test.ts`.
- **2.5 Drop password grant for CUI — 3.5.7/3.5.8/3.5.9.** Ensure `AUTH_PROVIDERS`
  excludes `password` under `CONTROLLED_ENVIRONMENT` and the password login/reset
  routes 404/redirect (`isAuthProviderEnabled`, `packages/env/src/index.ts:118`;
  `auth.server.ts` `signInWithPassword`/`resetPassword`). Chart also sets
  `GOTRUE_DISABLE_SIGNUP` / no password provider.
- **2.6 Auto-disable inactive accounts — 3.5.6.** Scheduled Inngest job deactivating
  accounts idle > N days (last-login from `auth.audit_log_entries`); on deactivation
  scrub residual `userId` references noted in
  `.claude/rules/user-employee-job-relationships.md`. Reuse `deactivateEmployee`
  et al. in `users.server.ts`.
- **2.8 Remove the `"0"` global-company permission wildcard — 3.1.5 (least privilege).**
  (Decided 2026-08-15: "we don't use it.") The `"0"` sentinel grants a permission
  across ALL companies (present + future) and is flagged by the audit as a broad-grant
  primitive. Remove it: rewrite the ~7 DB authz functions that special-case
  `'0' = ANY(permission_value)` (`get_claims`/`has_company_permission` — latest defs in
  `20250201181148_rls-refactor.sql` / `20241210140215_rls-performance.sql`; the API-key
  company-resolution fn in `20260219162954_api-key-scopes-rate-limits.sql:328`; the
  claims-admin guard `has_company_permission('update_users','0')` at
  `20230123004206_claims.sql:18`), the app gate (`auth.server.ts:364`), and the
  permission-matrix builder (`users.server.ts:1164-1288`); add grant-boundary
  validation rejecting `"0"`. **Safe-by-construction: expand-then-drop** — the same
  migration first expands any residual `"0"` grant to the subject's explicit
  `userToCompany` company IDs (behavior-preserving; no-op if truly unused) BEFORE the
  functions stop understanding `'0'`, so it cannot lock anyone out (live data not
  verifiable from this session — stack down, MCP needs auth). Own spec+plan
  (`.ai/specs/2026-08-16-remove-global-permission-wildcard.md` + `…/plans/2026-08-16-…`).
  `NOTIFY pgrst` after fn changes.
- **2.7 Consent-to-monitoring banner — 3.1.9.** Generalize `ItarLoginDisclaimer`
  (`login.tsx:531`) into a configurable login banner for non-controlled deployments.

**Verify:** N failed logins locks that account (not just the IP); idle session
redirects/locks after the threshold; MFA backend error denies rather than admits
under CUI; password login route is unreachable under CUI; an idle account is
auto-deactivated by the job.

---

## Phase 4 — Monitoring, integrity, error hygiene (P4, app items)

- **4.1 Security monitoring hooks — 3.14.6/3.14.7.** Emit CloudWatch metrics from
  the auth paths (failed-login count from 2.1, permission-denied from 1A.3) and 5xx
  from `entry.server.tsx:57`. In-boundary error monitoring: self-hosted Sentry **or**
  OTel exporter → CloudWatch (no external SaaS; respect `CONTROLLED_ENVIRONMENT`).
  Alarms/dashboards are **[chart]**.
- **4.2 Deepen `/health` — 3.14.6.** `apps/erp/app/routes/health.ts` pings only Redis;
  add DB + storage + Inngest reachability (keep it unauthenticated + cheap).
- **4.3 File-upload validation — 3.14.2/3.7.4.** Set `allowed_mime_types` + size
  limits on all storage buckets (migrations; several buckets lack limits today);
  server-side magic-byte check on upload (not just the serve-time extension map in
  `apps/erp/app/routes/file+/preview+/$bucket.$.tsx:8`). AV scan (ClamAV/Lambda on
  the `private` bucket) is **[chart]** but the quarantine-on-hit handling is app-side.
- **4.4 Fix error-detail leak — SI-11 (3.14.6-adjacent).** `packages/react/src/ErrorBoundary/RootErrorBoundary.tsx:96`
  renders `error.message` + first stack frame to end users, ungated. Gate the
  message/stack output behind `import.meta.env.DEV`; show a generic 500 + `requestId`
  in prod.
- **4.5 Verify analytics inert under CUI — 3.4.6.** Confirm PostHog
  (`entry.client.tsx:31`) and Vercel Analytics (`root.tsx:247`) are inert when
  `CONTROLLED_ENVIRONMENT`; add a boot assertion so a misconfig fails fast.

**Verify:** trigger a 500 in prod build → no stack/message shown, only a reference id;
oversized/wrong-MIME upload rejected; `/health` reports DB/storage/Inngest; failed-auth
and 5xx metrics appear in CloudWatch.

---

## Cross-cutting notes

- **Migrations:** several items add migrations (auth-audit RPC, append-only trigger,
  vault backfill, bucket mime/size limits). Follow the idempotency + timestamp-randomness
  lessons; run `pnpm run generate:types` before typecheck; DROP/recreate any views that
  gain columns.
- **Settings precedent:** 2.2/2.3 add `companySettings` fields — clone the `requireMfa`
  migration + `security.tsx` toggle + `CONTROLLED_ENVIRONMENT`-forced pattern exactly.
- **Tests:** extend `packages/auth/src/services/mfa-session.test.ts` (2.4) and add
  coverage for the lockout counter and session-timeout math; red→green per TDD.
- **Editions:** most items are all-edition, but the CUI-forcing behavior is keyed to
  `CONTROLLED_ENVIRONMENT`, independent of `CarbonEdition`.

## Suggested order

1. Quick code fixes first (hours each): **1C.3** (HMAC), **4.4** (error leak),
   **2.4** (MFA fail-open), **2.5** (drop password grant), **1A.3** (denied-audit),
   **1A.4** (audit on-by-default).
2. Then the data-model work: **1A.1/1A.2** (auth+permission audit), **1B.1** (append-only),
   **1C.1/1C.2** (vault) — these need migrations + a spec-level review. **[OQ]** whether
   1C warrants its own `.ai/specs/` entry given it touches every EE provider.
3. Then session/identity: **2.1, 2.2, 2.3, 2.6**.
4. Then integrity/monitoring: **4.1, 4.2, 4.3, 4.5**.

## Not in this repo (tracked in helm/niamey)

Pod `securityContext`, in-cluster mTLS, S3 Object Lock, blocking CI scans + SAST +
secret-scan + SBOM/signing, CloudWatch alarms/dashboards, the CI OIDC/ARC cutover,
and all Phase-5 program artifacts (SSP, POA&M, IR plan, ConMon, inheritance
statements). See `helm/niamey/docs/nist-800-171-remediation-plan.md`.
