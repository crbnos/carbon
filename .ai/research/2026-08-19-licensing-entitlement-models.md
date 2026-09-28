# Research — Licensing & Entitlement Models

**Date:** 2026-08-19
**For spec:** `.ai/specs/2026-08-19-licensing-entitlement-system.md`
**Question:** How should Carbon decide what a deployment is entitled to, across Cloud
(multi-region), Enterprise self-hosted, and Community?

Primary source for Infisical is the **decoded `infisical/license-api:latest` image**
(digest `sha256:6399149b…`) — the production build ships `tsup --sourcemap` with
`sourcesContent`, so the original TypeScript was recoverable — cross-read against the
public `Infisical/infisical` backend repo. GitLab and Grafana from vendor docs.

---

## 1. Infisical — credential-derived edition, split supply chains

### How the edition is chosen

There is **no `EDITION` variable**. The edition is derived at boot from which license
credential is present and whether it validates. First match wins
(`backend/src/ee/services/license/license-service.ts`, `init()`):

| # | Condition | Result |
|---|---|---|
| 1 | `LICENSE_SERVER_V2_SERVICE_KEY` set | `Cloud` |
| 2 | `LICENSE_SERVER_KEY` set + handshake succeeds | `Cloud` |
| 3 | `LICENSE_KEY` valid, online | `EnterpriseOnPrem` |
| 4 | `LICENSE_KEY` valid, offline signature verifies | `EnterpriseOnPremOffline` |
| 5 | none of the above | `OnPrem` (OSS floor) |

`init()` is wrapped in try/catch and the fall-through sets `isValidLicense = true`, so a
license failure **degrades to OSS rather than crashing**.

### Two supply chains, one plan object

- **Cloud** — Stripe subscription → product id → `subscription_tier_feature_sets` row →
  tier name + feature JSON. Per-request, cached in Redis 5 min.
- **Self-hosted** — signed license verified locally at boot into a module-level
  `onPremFeatures` object; refreshed by a 10-minute cron. **No network call in the
  request path.**

Both produce the same flat `TFeatureSet` (~60 fields: booleans, `null`-means-unlimited
limits, usage counters).

### Everything layers on an explicit floor

`getDefaultOnPremFeatures()` sets every boolean `false` and every limit `null`.
Entitlements are merged **on top** of that floor, so a feature the license does not
mention stays off. Fail-closed by construction.

### Tier identity is a database row

`getHigherSubscriptionTier` resolves multiple subscriptions via a **hardcoded priority
list** — enterprise → pro-annual → pro → team-annual → team → starter — falling back to
`"custom"`. The numeric `tier` field (0–3) exists in seed data but **nothing gates on
it**; there are no `tier >= N` comparisons. Every feature is an independent boolean.

Consequence: "Pro and above" does not exist as a concept. Slug is largely cosmetic —
except `isEnterpriseBypass` (`plan.slug === "enterprise" && !plan.enforceIdentityLimit`),
the one place the tier *name* changes behavior.

### Offline licensing

JSON document (`issuedTo`, `licenseId`, `customerId`, `issuedAt`, `expiresAt`,
`terminatesAt`, `features`) signed **RSA SHA-256 (PKCS#1)**, base64-bundled with its
signature. Verified against a public key in the binary. Two dates make expiry a ramp,
not a cliff.

**Defect worth avoiding:** they sign `JSON.stringify(license)`, so signature validity
depends on key ordering — any re-serialization silently breaks verification.

### What they got wrong

1. **Webhook acks before processing.** The Stripe webhook returns 201 immediately and
   processes in the background with only `.catch(log)`. A throw or crash is invisible to
   Stripe, so **no retry fires** and billing state silently drifts.
2. **Cache-miss + license-server outage = silent downgrade.** `getPlan` catches, writes
   the OSS feature set into the cache with normal TTL, and returns it. Paying customers
   lose SAML/audit-logs/seat-limits until the TTL expires. (Their *background* refresh
   path is explicitly written to avoid this; the cache-miss path is not.)
3. **No gate registry.** Hundreds of hand-written inline `if (!plan.X) throw` checks —
   the SAML check appears twice in one file. A new EE feature that forgets the check is
   simply free.

---

## 2. GitLab — activation code online, license file offline, **replicated via the DB**

- **Online:** a 24-character activation code obtained from the Customers Portal.
- **Offline/air-gapped:** a license file or key instead.
- **Scaled architecture:** upload the license to **one** application instance; *"The
  license is stored in the database and is replicated to all instances."*
- **Geo (multi-region):** upload to the primary; it replicates from there.
- **Offline obligation:** license usage data must be submitted **monthly by email** to
  the renewals service.
- One activation code may cover multiple instances when the user set is identical to, or
  a subset of, the licensed production instance.

**The directly applicable finding.** GitLab's answer to multi-instance and multi-region
is exactly *replicate through the database, never fetch per request*. Their control
plane (Customers Portal) is a real centralized system, but it sits in the activation
path, not the request path.

## 3. Grafana Enterprise — short-lived token, auto-renewed out of band

- Requires a valid token, **automatically renewed every 24 hours** via the Grafana API
  (`auto_refresh_license`).
- Instances without internet access must arrange alternative renewal with the account
  team.
- Public docs describe no grace-period behavior for an unreachable license server.

**Applicable finding.** Short-lived-but-auto-renewed is a workable revocation mechanism
*because the renewal is out of band*. A 24-hour token means failure to renew is the
revocation, with a bounded window — and no per-request dependency.

---

## 4. Cross-model synthesis

| Concern | Infisical | GitLab | Grafana |
|---|---|---|---|
| Edition selector | derived from credential | activation code / license file | license token |
| Air-gapped path | RSA-signed file | license file + monthly email usage | by arrangement |
| Multi-instance sync | per-instance credential | **DB replication from one upload** | per-instance token |
| Revocation | 10-min re-sync (online) | portal-side on renewal | 24-h token expiry |
| Request-path dependency | **yes on cloud** (the defect) | no | no |
| Gate registry | none | n/a | n/a |

**Consensus across all three:** entitlements are *materialized locally* and enforcement
reads local state. Centralization lives in issuance, renewal, and revocation — never in
the hot path. Infisical is the only one that violated this, and it is the only one with a
documented downgrade-on-outage failure mode.

**Consensus on air-gap:** every vendor supports a signed-file path, and every vendor
accepts that enforcement there is ultimately contractual (GitLab resorts to *emailed*
monthly usage reports).

**No vendor uses tier ranking.** GitLab has tiers but gates on explicit feature sets;
Infisical's numeric tier is vestigial. Independent per-feature entitlement is the norm.

---

## 5. Carbon's current state (for contrast; see spec for detail)

- `CARBON_EDITION` is an **unverified plain string** (`packages/env/src/index.ts:133`),
  compared three times, defaulting to `Community`.
- **Both server gates open completely off-cloud** —
  `if (CarbonEdition !== Edition.Cloud) return true` (`packages/ee/src/plan.server.ts:41`,
  and `return;` at `:66`). This is *documented intended behavior* in
  `.claude/rules/billing-system.md` ("Gating is a no-op off Cloud"), not an oversight.
- The **client gate disagrees** — `usePlanGate` (`apps/erp/app/hooks/usePlanGate.ts:13`)
  computes `isCommunity || (isCloud && !meets)`, so Community is hidden in the UI while
  the server allows it, and Enterprise is fully open on both.
- `getCompanyPlan` **discards the Supabase `error`** and uses `.single()`, so a transient
  read failure yields `Plan.Unknown`, which satisfies no requirement → a paying customer
  is silently gated. Uncached across ~80 call sites.
- `CARBON_EDITION: carbon_edition ?? "enterprise"` (`ci/src/deploy.ts:276`) — a **null
  column deploys as Enterprise**, i.e. fully unlocked.

### What Carbon already has that the others do not

- **`FEATURE_PLANS`** (`packages/ee/src/plan.ts:8`) — a single declarative registry, 10
  features → allowed plans, read by *both* client and server. Infisical has no equivalent.
- A **control plane that already exists**: the `workspaces` Supabase read by
  `ci/src/deploy.ts`, holding every deployment's region, database, domain, Stripe keys and
  `carbon_edition`. It already spans EU and US.
- `syncStripeDataToKV` as the **single writer** of `companyPlan` from Stripe, with the
  webhook processed **synchronously** (so Stripe's retries are meaningful — the opposite
  of Infisical's defect).

---

## 6. Design implications

1. **Centralize issuance, replicate entitlements, enforce locally.** GitLab's model.
   Carbon's `workspaces` Supabase is already the control plane; what is missing is an
   entitlement model on it and a runtime push path (today `carbon_edition` is bound at
   *deploy* time, so changing a plan requires a redeploy).
2. **Replica, not cache.** A cache miss means going to ask, which puts the remote back in
   the critical path — Infisical's exact failure. Push entitlements into each stack's own
   Postgres; the gate never makes a network call.
3. **One entitlement axis.** Edition should decide *where entitlements come from*, never
   *whether to gate*. That deletes the `!== Cloud` escape hatch.
4. **Explicit floor.** Community is a floor merged under, not a bypass.
5. **Three states, not two.** "no plan" and "could not read the plan" must be
   distinguishable; only the former may gate.
6. **Sign canonical bytes**, not a re-serialized object.
7. **Fail-open for ERP feature entitlement**, deliberately opposite to Infisical. Wrongly
   denying a paying factory is a support incident; wrongly granting for 60 s costs
   nothing.

## Sources

- Decoded `infisical/license-api:latest` (source maps) + [Infisical/infisical](https://github.com/Infisical/infisical)
- [Activate GitLab Enterprise Edition (EE)](https://docs.gitlab.com/administration/license/)
- [Activate GitLab EE with a license file or key](https://docs.gitlab.com/17.5/administration/license_file/)
- [Grafana Enterprise license](https://grafana.com/docs/grafana/latest/administration/enterprise-licensing/)
- [Grafana enterprise configuration](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/enterprise-configuration/)
