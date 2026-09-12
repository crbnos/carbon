# Licensing & Entitlement System

> Status: draft
> Author: Sid
> Date: 2026-08-19
> Research: [`.ai/research/2026-08-19-licensing-entitlement-models.md`](../research/2026-08-19-licensing-entitlement-models.md)

## TLDR

Carbon currently decides entitlements from an unverified environment string, and both
server-side gates return `true` for every deployment that is not Cloud — so Community and
Enterprise self-hosted installs are enforced only by the UI hiding buttons. This spec
replaces that with a single entitlement axis: **edition selects where entitlements come
from; entitlements alone decide what is unlocked.** Cloud resolves from `companyPlan`
(unchanged, Stripe-driven), self-hosted resolves from an **Ed25519-signed licence**, and
Community resolves from an explicit floor. The `workspaces` Supabase that CI already reads
becomes the licence control plane: it issues, renews and revokes. Critically, **no Carbon
request handler ever calls the control plane** — entitlements are replicated into each
deployment's own Postgres and read locally, so the control plane can be down without any
customer noticing.

## Problem Statement

### 1. The server gates open completely off-cloud

`packages/ee/src/plan.server.ts`:

```ts
:41   if (CarbonEdition !== Edition.Cloud) return true;   // companyHasPlan
:66   if (CarbonEdition !== Edition.Cloud) return;        // requirePlan
```

Every one of the 10 gated features — `API_KEYS`, `WEBHOOKS`, `INTEGRATIONS`, `ITEM_RULES`,
`AUDIT_LOG`, `EMAIL_NOTIFICATIONS`, `STORAGE_RULES`, `CUSTOMER_PORTALS`, `AI_AGENT`,
`WORKFLOWS` — is reachable on any self-hosted install via a direct route or action.

This is *documented intended behaviour* (`.claude/rules/billing-system.md`: "Gating is a
no-op off Cloud"), which makes closing it a **contract change, not a bug fix**. It
contradicts the commercial position that self-host is Community-only and EE requires a
paid licence.

### 2. The client gate disagrees with the server

`apps/erp/app/hooks/usePlanGate.ts:13`:

```ts
isGated = isCommunity || (isCloud && !planMeetsRequirement(currentPlan, requirement));
```

| Edition | Client UI | Server gate | Net effect |
|---|---|---|---|
| Cloud | enforced | enforced | correct |
| Community | hidden | **open** | UI hidden, API reachable |
| Enterprise | open | open | one env string unlocks everything |

Two sources of truth answering the same question differently. The server is authoritative,
and it is the permissive one.

### 3. `CARBON_EDITION` is unverified, and its default is backwards

`packages/env/src/index.ts:133` reads a plain string and compares it three times.
No signature, no expiry, no revocation. Anyone who can set an env var can grant themselves
Enterprise.

Worse, `ci/src/deploy.ts:276`:

```ts
CARBON_EDITION: carbon_edition ?? "enterprise"
```

A `workspaces` row with a null column deploys **fully unlocked**. The safe default is
inverted.

### 4. A transient DB read silently downgrades paying cloud customers

`packages/ee/src/plan.server.ts:22`:

```ts
const { data } = await client.from("companyPlan")
  .select("planId").eq("id", companyId).single();
return normalizePlanId(data?.planId);
```

The Supabase `error` is discarded and `.single()` throws on zero rows, so any transient
failure yields `data === null` → `Plan.Unknown` → satisfies no requirement → **gated**. The
gate cannot distinguish "this company has no plan" from "I could not find out". It is
uncached across ~80 call sites, so a single page load can roll this repeatedly.

### 5. Entitlements are bound at deploy time

`carbon_edition` is read from `workspaces` by CI and baked into the stack's environment.
Changing a customer's entitlement **requires a redeploy**. There is no revocation, and
nothing evaluates time.

### 6. No signing or verification infrastructure exists

Earlier notes and design documents refer to offline Ed25519 licence verification as though
it were built. It is not: `ed25519` appears **nowhere in the codebase**, there is no
`packages/auth/src/license/`, no signing tooling, and no git history for any of it on any
branch. Everything in this spec's licence path is greenfield.

## Proposed Solution

### Architecture — three layers, one direction of flow

```
CONTROL PLANE                REPLICATION              LOCAL ENFORCEMENT
(workspaces Supabase)        (async, out-of-band)     (in each deployment)

issue / renew / revoke  ──►  push to cloud stacks ──► companyPlan     ─┐
licence signing (Ed25519)    check-in pull (self-    instanceLicense  ─┼─► resolveEntitlements()
usage + seat reporting        hosted, connected)     COMMUNITY_FLOOR  ─┘        │
                                                                                ▼
                                                                       one gate, local read only
```

**The invariant, and the reason for the whole design: no Carbon request handler ever makes
a network call to the control plane.** Entitlements are *replicated*, not *fetched*. A
cache implies a miss means going to ask, which puts the remote back in the critical path —
that is precisely Infisical's documented downgrade-on-outage failure. When the control
plane is down, entitlements stop *changing*; nothing stops *working*.

### One entitlement axis

Edition stops being an input to gating. It selects only the **source**:

| Edition | Entitlement source |
|---|---|
| `Cloud` | `companyPlan.planId` (Stripe-driven, per company) |
| `Enterprise` | verified `instanceLicense` payload (per deployment) |
| `Community` | `COMMUNITY_FLOOR` constant |
| `Test` | fixture (unchanged) |

All four produce the same shape, so `if (CarbonEdition !== Edition.Cloud)` has nowhere left
to live.

Granularity differs deliberately: cloud entitlements are **per company**; a self-hosted
licence covers **the whole deployment**, so every company in that install resolves to the
same entitlement.

### The resolved type

```ts
// packages/ee/src/entitlements.ts
export type EntitlementSource = "cloud" | "license" | "community" | "test";
export type EntitlementStatus = "active" | "expired" | "terminated";

export type Entitlements = {
  plan: Plan;
  features: Record<Feature, boolean>;   // resolved: FEATURE_PLANS[plan] + overrides
  source: EntitlementSource;
  status: EntitlementStatus;
  seats: { licensed: number | null; used: number };
  expiresAt: string | null;
  terminatesAt: string | null;
};

// Three states, not two — "no plan" and "could not read" must never collapse.
export type EntitlementResult =
  | { ok: true; entitlements: Entitlements }
  | { ok: false; reason: "unreadable"; lastKnownGood: Entitlements | null };
```

`Plan.Unknown` stops meaning "free" and means **"read failed"** exclusively.

### The single gate

`resolveEntitlements(client, companyId): Promise<EntitlementResult>` is the only entry
point. `companyHasPlan` / `requirePlan` become thin wrappers over it, and the **client
receives the resolved `Entitlements` object** from the `/x` loader rather than computing
its own verdict from the edition — so client and server become structurally incapable of
disagreeing.

On `{ ok: false }`:
- serve `lastKnownGood` when present;
- otherwise **fail open**, log at error level, and emit a metric.

This is deliberately the opposite of Infisical's fail-closed choice, and the asymmetry is
the reason: wrongly denying a paying factory is a support incident and a churn risk;
wrongly granting a feature for 60 seconds costs nothing and self-corrects.

### Licence format

A **compact JWS** (`header.payload.signature`, base64url, `alg=EdDSA`), delivered via
`CARBON_LICENSE`. The JWS **header** carries `kid` (key id); the **payload** is:

```jsonc
{
  "v": 1,
  "licenseId": "lic_...",
  "issuedTo": "Acme Manufacturing Co",
  "workspaceId": 42,
  "planId": "PARTNER-400",          // resolved through FEATURE_PLANS at runtime
  "overrides": { "AI_AGENT": false }, // bespoke deals, optional
  "seats": 250,
  "mode": "connected",               // "connected" | "airgapped"
  "checkInUrl": "https://license.carbon.ms/v1/check-in",
  "issuedAt": "2026-08-19T00:00:00Z",
  "expiresAt": "2026-09-18T00:00:00Z",
  "terminatesAt": "2026-10-18T00:00:00Z"
}
```

- Signed by the **closed-source Go control plane** with `go-jose`; verified in
  `packages/ee/src/license/verify.ts` with **`jose`** (`jwtVerify` / `compactVerify`,
  `alg: "EdDSA"`). Because JWS signs the base64url-encoded bytes verbatim, there is **no
  canonicalization step** and Infisical's `JSON.stringify` key-ordering defect cannot occur.
  Verification always validates the signature **before** the payload is parsed.
- `kid` selects from a public-key map compiled into `packages/ee/src/license/keys.ts`
  (public keys only), so keys rotate without invalidating issued licences. The **private key
  exists only in the Go control plane and never in this repo**.
- `planId` (not an explicit feature list) means a new EE feature added to `FEATURE_PLANS`
  reaches every existing licence holder automatically, with no reissue.

### Dual-mode renewal

| Mode | Term | Renewal | Target |
|---|---|---|---|
| `connected` | 30 days | check-in every 24 h, receives a fresh licence | default for self-hosted |
| `airgapped` | 1 year | none attempted | plants with restricted or no egress |

Check-in is an Inngest scheduled job, **never a request-path call**. On failure it retries
with exponential backoff and the install keeps running on its current licence until
`expiresAt`. With a 30-day term and daily check-in, the control plane must be unreachable
for **30 consecutive days** before any customer is affected, with 29 days of escalating
warnings first — so a control-plane outage of any realistic length is invisible.

`airgapped` licences never attempt egress at all. This exists because restricted-egress
plant networks are ordinary in manufacturing, not because of any particular compliance
regime: a customer whose ERP host cannot dial out is a normal deal, and discovering that
mid-implementation is far more expensive than carrying a second mode.

### Two-stage expiry — the line stops being automated, never stops running

| Window | `status` | `capability` features | `accessControl` features |
|---|---|---|---|
| `now < expiresAt` | `active` | full entitlement | full entitlement |
| `expiresAt ≤ now < terminatesAt` | `expired` | cannot create new artifacts; existing keep running; banner | cannot create/edit rules; existing rules keep enforcing; banner |
| `now ≥ terminatesAt` | `terminated` | drops to floor; existing automations **pause** (workflows stop firing, webhooks stop delivering) | existing rules **freeze** — keep enforcing indefinitely; only authoring stays blocked |

The split in the last row is the whole safety property: a paused workflow is safe, a paused
restriction is a leak. `accessControl` features therefore never lose their existing enforcement,
at any status — the licence only ever governs whether new rules can be authored.

**Invariant preserved at every stage:** degradation never falls below `COMMUNITY_FLOOR`
and never touches core ERP. Orders, jobs, receipts, shipping and printing are unaffected by
any licence state. This holds structurally today because `FEATURE_PLANS` covers only the 10
EE features, and the spec must not widen it.

### Invariant: entitlements gate access-control *configurability*, never *enforcement*

Advanced RBAC is a planned EE feature, so "never make RBAC a feature" is the wrong rule —
it would either block a real product or, done naively, leak data. The correct rule splits
RBAC into two things that must be treated completely differently:

| | What it is | Licensable? |
|---|---|---|
| **Enforcement** | RLS reading `userPermission` (`get_companies_with_employee_permission(...)`); `requirePermissions` reading claims | **Never.** Structurally always-on |
| **Configurability** | defining custom roles, field/record-level rules, granular scoping beyond the built-in employee types | **Yes** — this is the sellable surface |

The enforcement engine is a Postgres RLS policy reading a database table; the application
cannot bypass it without the service role, and **no policy or permission claim ever reads
`companyPlan` or entitlement state.** What a licence gates is the *ability to author* granular
rules — never the engine that enforces the rules already authored.

**Why this makes fail-open safe.** Failing open turns features on; it cannot change which
rows Postgres returns for a given JWT. A user without `accounting_view` cannot reach the GL
under any entitlement state, including total resolution failure. The floor already contains a
complete, always-on access-control engine: the built-in employee-type permission model
(`employeeType` → `employeeTypePermission` → `userPermission`), which is **not** in
`FEATURE_PLANS` and never will be.

**The direction-of-failure rule.** A *feature* fails **open** (losing "workflows" turns
automation off — safe). *Access control* fails **closed** (a restriction must only ever show
*less*, never more). Therefore **a restriction is never lifted by a licence state change.**
The dangerous shape is a custom rule that *narrows* access ("warehouse staff see only their
site"); if a lapse lifted it, those users would suddenly see everything. That is precisely
Infisical's `rbac: false` OSS floor, and it is the leak this section exists to forbid.

**Two mechanical guarantees (not judgement calls):**

1. **No RLS policy or permission-claim function references `companyPlan` or any entitlement
   table.** Enforced by a `@carbon/checks` SQL conformance rule scanning policy and function
   bodies.
2. **No entitlement / licence / lapse code path ever writes `userPermission`,
   `employeeTypePermission`, or the claims tables.** Permission grants are mutated only by
   explicit admin action, never as a side effect of a licence state transition — so a lapse
   can never rewrite a grant to be more permissive. Enforced by a `@carbon/checks` rule
   asserting the `packages/ee` licence/entitlement modules never write those tables.

**Feature classification.** Every `Feature` is tagged `capability` or `accessControl`. This
tag changes only the `terminatesAt` behaviour (see two-stage expiry): `capability` features
*pause*, `accessControl` features *freeze* — existing rules keep enforcing forever; only
create/edit is blocked (already at `expiresAt`). You never "pause" a restriction, because a
paused restriction is a disclosure.

Note `CUSTOMER_PORTALS` as the one gated feature whose enabled state has external-facing
consequences. Failing open does not publish anything — a portal must still be created and its
link shared — but feature state and data exposure are adjacent there, and that adjacency must
not deepen.

### Seats — advisory, never blocking

Mirrors what Cloud already does (`updateSubscriptionQuantityForCompany` adjusts the Stripe
quantity and never blocks). Self-hosted installs report actual counts at check-in, admins
see an over-seat banner, and overage is trued up at renewal. No user creation is ever
refused for seat reasons.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Entitlement axis | Edition selects source; entitlements alone gate | Deletes the `!== Cloud` escape hatch; one code path |
| Cloud storage | Reuse `companyPlan` | `companyPlan.id == company.id` is already the per-company mirror; `syncStripeDataToKV` is already its single writer |
| Self-host storage | New instance-level `instanceLicense` | Precedent: `plan` is already instance-level (no `companyId`, single-col PK) in this same subsystem |
| Control plane | **Closed-source Go server** (separate repo) in front of the existing `workspaces` Supabase Postgres | Holds the private signing key + commercial issuance/revocation policy, which must NOT live in the AGPL source-available monorepo. Go: `crypto/ed25519` in stdlib, single static binary, isolated so the second-language cost is bounded. The `workspaces` Postgres remains the DB (already spans EU/US, `license.workspaceId` → `workspaces.id`) |
| Language split | Go issuer (closed) vs TypeScript verifier (open); shared only by a JWS token format | The issuer's secrecy has value; the verifier runs inside every source-available deployment and must be TS in `packages/ee`. Zero shared code — only base64url token strings cross the boundary |
| Sync model | Replica (push / scheduled pull), never request-path fetch | GitLab replicates licences through the DB; Infisical's per-request fetch is the one documented downgrade-on-outage failure |
| Read-failure behaviour | Three states; serve last-known-good, else fail **open** + alert | ERP asymmetry: wrongly denying a paying factory ≫ wrongly granting for 60 s |
| Signature / token format | **Compact JWS, `alg=EdDSA` (Ed25519)**, with `keyId` in the header | Language-neutral standard: Go signs (`go-jose`), TS verifies (`jose`). The signature covers the base64url-encoded bytes verbatim, so no canonicalization library is needed and Infisical's `JSON.stringify` key-ordering defect cannot occur. `keyId` selects the public key, allowing rotation without invalidating issued licences |
| Licence body | `planId` + optional `overrides` | New features reach existing licences with no reissue; bespoke deals need no code change; identical resolution path to cloud |
| Tier comparison | Keep `requirement.includes(plan)` membership | No vendor researched ranks tiers; explicit beats implied for licensing |
| `Plan.Community` | Own enum member, contents identical to Starter today | "Decide later" requires the two to diverge without touching cloud Starter |
| Null `carbon_edition` | → `Community` | `ci/src/deploy.ts:276` currently defaults to unlocked |
| **H1** Multi-tenancy | `instanceLicense` is deliberately **not** company-scoped | A licence covers a whole deployment, not a tenant. Follows the `plan` table precedent. `companyPlan` (company-scoped) is unchanged |
| **H2** Service shape | `resolveEntitlements(client, …)` takes client first, returns a result union, never throws | `.claude/rules/conventions-services.md` |
| **H3** RLS | `instanceLicense`: SELECT `auth.role() = 'authenticated'`; no write policy, so service-role only | Mirrors the existing `plan` policy (`20250619100940_billing.sql:91`) exactly. Readable for banners, writable only by the check-in job |
| **H4** Permissions | Licence admin routes use `requirePermissions(request, { update: "settings" })` | Existing scope, same as `settings+/audit-logs.tsx:71` and `settings+/backups.tsx:105`; no new module |
| **H5** Forms | Licence upload uses `ValidatedForm` + `validator(zodSchema)` | `.claude/rules/conventions-forms.md` |
| **H6** Module layout | Lives in `packages/ee/src/license/` beside existing `plan.ts` / `plan.server.ts` | EE gating already lives in `packages/ee`; not an ERP module |
| **H7** Backward compat | `FEATURE_PLANS`, `GateSpec`, `companyHasPlan`, `requirePlan` signatures all preserved | ~80 call sites unchanged; only the internals and the off-cloud behaviour change |

## Data Model Changes

### App-side (each deployment's Postgres) — new

```sql
-- Instance-level, deliberately NOT company-scoped: a licence covers the whole
-- deployment. Follows the existing instance-level "plan" table precedent.
-- Singleton enforced by a fixed primary key.
CREATE TABLE "instanceLicense" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "licenseId" TEXT NOT NULL,
    "issuedTo" TEXT NOT NULL,
    "planId" TEXT NOT NULL REFERENCES "plan"("id"),
    "overrides" JSONB,
    "seats" INTEGER,
    "mode" TEXT NOT NULL DEFAULT 'connected',
    "checkInUrl" TEXT,
    "issuedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "terminatesAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "bundle" TEXT NOT NULL,                -- the verified base64 bundle, for re-verify
    "keyId" TEXT NOT NULL,
    "lastCheckInAt" TIMESTAMP WITH TIME ZONE,
    "lastCheckInError" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT "pk_instanceLicense" PRIMARY KEY ("id"),
    CONSTRAINT "ck_instanceLicense_singleton" CHECK ("id" = 'singleton'),
    CONSTRAINT "ck_instanceLicense_mode" CHECK ("mode" IN ('connected','airgapped'))
);

ALTER TABLE "instanceLicense" ENABLE ROW LEVEL SECURITY;
-- Readable by any authenticated user (drives the admin banner); written only by the
-- service-role check-in job. Mirrors the existing "plan" policy in
-- 20250619100940_billing.sql:91 — no INSERT/UPDATE/DELETE policy is defined, so only
-- the service role can write.
CREATE POLICY "SELECT" ON "instanceLicense"
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
  );
```

`companyPlan`, `plan` and `companyUsage` are **unchanged**.

### Control plane (`workspaces` Supabase) — new

Not Carbon tenant data; does not follow `companyId` conventions.

```sql
CREATE TABLE "license" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "workspaceId" INTEGER NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "issuedTo" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "overrides" JSONB,
    "seats" INTEGER,
    "mode" TEXT NOT NULL DEFAULT 'connected',
    "termDays" INTEGER NOT NULL DEFAULT 30,
    "graceDays" INTEGER NOT NULL DEFAULT 30,      -- terminatesAt = expiresAt + graceDays
    "revokedAt" TIMESTAMP WITH TIME ZONE,
    "revokedReason" TEXT,
    "keyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT "pk_license" PRIMARY KEY ("id")
);

CREATE TABLE "licenseCheckIn" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "licenseId" TEXT NOT NULL REFERENCES "license"("id") ON DELETE CASCADE,
    "seatsUsed" INTEGER,
    "companiesCount" INTEGER,
    "version" TEXT,
    "checkedInAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT "pk_licenseCheckIn" PRIMARY KEY ("id")
);
CREATE INDEX "licenseCheckIn_licenseId_idx" ON "licenseCheckIn" ("licenseId", "checkedInAt" DESC);
```

`workspaces.carbon_edition` is retained but its CI default flips to `community`.

## API / Service Changes

### `packages/ee/src/entitlements.ts` (new)

- `COMMUNITY_FLOOR: Entitlements` — `plan: Plan.Community`, every feature `false`.
- `resolveFeatures(plan, overrides?): Record<Feature, boolean>` — `FEATURE_PLANS` merged
  with overrides on top.
- `applyStatus(ent, now): Entitlements` — two-stage expiry.

### `packages/ee/src/entitlements.server.ts` (new)

- `resolveEntitlements(client, companyId): Promise<EntitlementResult>` — dispatches on
  edition; captures Supabase `error`; uses `.maybeSingle()`.
- Redis last-known-good cache, 60 s TTL, keyed per company. Also removes the current
  uncached N+1 across ~80 gate call sites.

### `packages/ee/src/license/` (new)

- `keys.ts` — `kid → Ed25519 public key` map (public keys only).
- `verify.ts` — `verifyLicense(jws): VerifiedLicense | LicenseError` via `jose` `compactVerify`
  (`alg: "EdDSA"`); the JWS signature over the encoded bytes is validated **before** the
  payload is parsed.
- `install.server.ts` — verify + upsert into `instanceLicense`.

### `packages/ee/src/plan.server.ts` (rewritten internals, same exports)

`companyHasPlan` and `requirePlan` keep their signatures and become wrappers over
`resolveEntitlements`. **The `CarbonEdition !== Edition.Cloud` short-circuits are deleted.**
`isBypassCompany` is retained unchanged.

### `packages/jobs` (new)

- `licenseCheckIn` — scheduled every 24 h. Skips when `mode = 'airgapped'`. Posts
  `{licenseId, seatsUsed, companiesCount, version}`, receives a renewed bundle, verifies and
  installs it. Exponential backoff; writes `lastCheckInError`; never throws into a request.

### Control plane — closed-source Go server (separate repo)

Not part of this monorepo. Connects to the `workspaces` Supabase Postgres (owns the `license`
/ `licenseCheckIn` tables), holds the Ed25519 **private** key (KMS or a sealed secret, never
in source), and exposes:

- `POST /v1/check-in` — authenticated by the presented licence JWS; verifies it, records a
  `licenseCheckIn` row (seats/companies/version), and returns a freshly signed licence JWS, or
  `{ "status": "revoked" }` when `license.revokedAt` is set.
- Admin CRUD for issuing, revoking, and re-issuing licences (internal-only surface).

Signing uses `go-jose` (`alg=EdDSA`); the token it emits is verified unchanged by the TS
`jose` verifier in `packages/ee`. The two sides share only the JWS wire format — no code, no
types, no build dependency.

### `ci/src/deploy.ts`

`CARBON_EDITION: carbon_edition ?? "community"` and pass `CARBON_LICENSE` through as a new
workspace column.

## UI Changes

- **Settings → Licence** (`/x/settings/license`) — issued-to, plan, seats licensed vs used,
  status, expiry dates, last check-in, and an upload form for air-gapped bundles.
- **Global banner** when `status !== "active"` or seats are exceeded — copy differs for
  `expired` ("cannot create new …, renew by {terminatesAt}") vs `terminated`.
- **`usePlanGate`** reads the resolved `Entitlements` from `/x` route data; the
  `isCommunity || …` expression is deleted.
- Existing upgrade-prompt UI is unchanged — it now simply fires on self-host too.

## Acceptance Criteria

- [ ] With `CARBON_EDITION=community` and no licence, a `POST` to `/x/settings/api-keys/new`
      is refused with the upgrade flash — it currently succeeds.
- [ ] With `CARBON_EDITION=community`, `usePlanGate({feature:"AUDIT_LOG"}).isGated === true`
      **and** `companyHasPlan(client, id, {feature:"AUDIT_LOG"}) === false` — client and
      server agree for all 10 features across all 4 editions (table-driven test).
- [ ] A workspace row with `carbon_edition = NULL` deploys with `CARBON_EDITION=community`.
- [ ] A licence signed with a valid key installs and grants exactly `FEATURE_PLANS[planId]`
      merged with `overrides`; a bundle with one byte flipped is rejected and nothing is
      written to `instanceLicense`.
- [ ] A licence issued by the Go control plane verifies unchanged in the TS `jose` verifier
      (cross-language round-trip), and re-serializing the payload with different key order does
      not affect verification — the JWS covers the encoded bytes, so Infisical's `JSON.stringify`
      defect cannot occur.
- [ ] With `companyPlan` unreadable (simulated error) and a warm cache, a Business company
      keeps Business features; with a cold cache it fails open, logs at error level, and
      emits a metric — it never returns `Plan.Unknown` as an entitlement.
- [ ] At `expiresAt < now < terminatesAt`: creating a workflow is refused, an existing
      workflow still fires on its trigger, and the banner names the terminate date.
- [ ] At `now > terminatesAt`: entitlements equal `COMMUNITY_FLOOR` and existing workflows
      no longer fire.
- [ ] At every licence status, a user can still create a sales order, receive against a PO,
      and print a job traveler.
- [ ] **Access control is unaffected by entitlement state.** With entitlement resolution
      forced to total failure (fail-open path), a user lacking `accounting_view` still
      receives zero GL rows, and a user in company A still receives zero company-B rows —
      asserted directly against the database, not through the UI.
- [ ] **A licensed access-control rule survives licence lapse.** On an install with a custom
      RBAC rule narrowing a user's visibility, driving the licence past `terminatesAt` leaves
      that user's row visibility unchanged — the narrowing rule still enforces — while
      attempting to create a new such rule is refused. Asserted against the database.
- [ ] **A licence-server outage cannot widen access.** With the control plane unreachable and
      the licence expired, no user's `userPermission` rows change and no user sees more rows
      than before the outage.
- [ ] The `@carbon/checks` SQL rule fails the build if any RLS policy or permission-claim
      function body references `companyPlan` or an entitlement table.
- [ ] The `@carbon/checks` rule fails the build if any `packages/ee` licence/entitlement
      module writes `userPermission`, `employeeTypePermission`, or a claims table.
- [ ] `mode: "airgapped"` makes zero outbound requests over a 48 h run (network assertion in
      the job test).
- [ ] Check-in failure for 3 consecutive days leaves entitlements fully active and records
      `lastCheckInError`.
- [ ] Exceeding `seats` shows the banner and blocks nothing; `seatsUsed` appears in the
      next `licenseCheckIn` row.
- [ ] Revoking a licence in the control plane causes the next check-in to drop the install
      to `COMMUNITY_FLOOR`.
- [ ] `.claude/rules/billing-system.md` no longer states that gating is a no-op off Cloud.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Closing off-cloud gating breaks existing self-hosted installs | High | Accepted deliberately (Q1). Release-note it as a breaking change; the upgrade path is buying a licence. `.claude/rules/billing-system.md` rewritten in the same PR |
| Fail-open is exploitable by inducing DB read failures | Medium | Only reachable by an actor who can already disrupt the tenant's own Postgres; scoped to the 60 s TTL; every occurrence alerts. **Bounded by the access-control invariant** — failing open enables features, never data visibility, so the worst case is a feature the customer has not paid for, never a disclosure |
| Advanced RBAC is sold, and a lapse lifts a narrowing rule → org-wide exposure | High | The enforcement/configurability split: the licence gates authoring, never the RLS engine; `accessControl` features freeze (never pause) at `terminatesAt`; and no licence path may write the permission tables. This is exactly Infisical's `rbac: false` fail-to-floor leak, forbidden here by two build-enforced `@carbon/checks` rules |
| Licence-server outage indirectly widens access | High | Impossible by construction: an outage can only affect entitlement *state*, which never reaches `userPermission` or any RLS policy. The worst an outage produces is a frozen access-control rule (still enforcing) plus features failing open — never a lifted restriction |
| Ed25519 private key compromise | High | Control plane only, never in this repo; `keyId` allows rotation without invalidating outstanding licences |
| Clock skew grants or denies entitlement incorrectly | Medium | 24 h skew tolerance on `expiresAt`; `terminatesAt` grace is 30 days, far exceeding plausible skew |
| Dual mode doubles v1 scope | Medium | Phased: air-gapped (no check-in) ships first and is independently useful; connected mode follows |
| Air-gapped installs are unenforceable after `terminatesAt` | Low | Accepted — every vendor researched has this limit (GitLab resorts to emailed monthly usage). The licence is a contractual and audit instrument, not DRM |
| Someone forks and deletes the check | Low | Accepted and explicit. The goal is to make violation deliberate and provable, not impossible |
| A new EE feature ships without a gate | Medium | `FEATURE_PLANS` is the registry; add a conformance check in `@carbon/checks` asserting every `Feature` key has ≥1 gate call site |

## Open Questions

> Resolved with the user on 2026-08-19 **before** this spec was written. This section is the
> audit trail, not a to-do list.

- [x] **How should enforcing Community server-side land, given it removes features existing
      self-hosted installs reach today?** — **Answer: close outright.** Next release
      enforces; no deprecation window, no grandfather flag. Consistent with the commercial
      position that self-host is Community-only and EE requires a paid licence. Cost:
      `.claude/rules/billing-system.md` must be rewritten and this is a release-noted
      breaking change.
- [x] **What does `COMMUNITY_FLOOR` contain?** — **Answer: same as Starter (zero of the 10
      gated features), revisit on self-host telemetry.** Chosen as the reversible direction:
      expanding a free tier later is easy, contracting it is not. Follow-on decision taken by
      the author: `Plan.Community` gets its own enum member rather than aliasing
      `Plan.Starter`, since "decide later" requires the two to diverge independently.
- [x] **What entitlement does a signed self-hosted licence carry?** — **Answer: `planId` plus
      an optional `overrides` map.** Features resolve through `FEATURE_PLANS` at runtime, so
      cloud and self-host share one resolution path, a new EE feature reaches existing
      licence holders with no reissue, and bespoke contracts need no code change.
- [x] **How do self-hosted licences expire and renew?** — **Answer: dual mode.** Connected
      installs check in every 24 h and auto-renew a 30-day licence; restricted-egress installs
      receive long-dated files and never attempt egress. *Answered "short-lived, check-in
      required", re-asked, then confirmed as dual mode on 2026-08-20 after the enterprise
      deployment work was explicitly set aside as a constraint — so the decision now rests
      solely on restricted-egress plant networks being ordinary in manufacturing, and on the
      cost of discovering one mid-deal exceeding the cost of a second mode.* Cost: roughly
      doubles v1; mitigated by shipping `airgapped` first (phase 2, no check-in needed) and
      `connected` after (phase 3).
- [x] **What happens on lapse to EE artifacts already created?** — **Answer: two-stage.**
      `expiresAt` blocks creating new EE artifacts while existing ones keep running;
      `terminatesAt` pauses existing EE automations. Core ERP is untouched at every stage —
      the line stops being automated, never stops running.
- [x] **What happens when a self-hosted install exceeds its seats?** — **Answer: advisory +
      true-up.** Never block; report counts at check-in, banner for admins, true up at
      renewal. Mirrors cloud, where `updateSubscriptionQuantityForCompany` adjusts the Stripe
      quantity and never blocks.

## Phasing

Each phase is independently shippable and independently valuable.

| Phase | Content | Depends on |
|---|---|---|
| 0 | Three live bug fixes: capture the Supabase `error` + `.maybeSingle()`; flip the CI null default to `community`; add the last-known-good cache | — |
| 1 | `Entitlements` type, `resolveEntitlements`, `COMMUNITY_FLOOR`, `Plan.Community`; delete both `!== Cloud` short-circuits and the client's `isCommunity ||`; rewrite `billing-system.md` | 0 |
| 2 | Licence format, Ed25519 verification, `instanceLicense`, settings UI, **air-gapped mode** | 1 |
| 3 | Control-plane `license` / `licenseCheckIn` tables, check-in endpoint, **connected mode** + renewal, seat reporting | 2 |
| 4 | Two-stage expiry enforcement (workflow/webhook pause at `terminatesAt`), banners, revocation | 3 |

Phase 0 is worth landing on its own regardless of the rest — it removes a live downgrade
risk for paying cloud customers today.

## Changelog

- 2026-08-19: Created. Six open questions resolved with the user before writing.
- 2026-08-20: Enterprise-deployment work set aside as a design constraint at the user's
  direction. Q4 re-confirmed as dual mode on its own merits (restricted-egress plant
  networks), and all dependencies on that work removed — the licence path is greenfield and
  this spec no longer cites or relies on it.
- 2026-08-20: Access-control invariant reworked after the user confirmed advanced RBAC will be
  a licensed feature. Split enforcement (never gated) from configurability (sellable); added
  the `capability`/`accessControl` feature tag; `accessControl` features **freeze** rather than
  pause at `terminatesAt` (resolved with the user); added two build-enforced conformance rules
  (no RLS/claim reads entitlements; no licence path writes permission tables) and matching
  acceptance criteria. A licence-server outage can never widen access — proven by construction.
- 2026-08-20: Control-plane language/hosting decided with the user. Closed-source **Go**
  server (separate repo) owns issuance, revocation, the check-in endpoint, and the Ed25519
  **private** key — deliberately NOT an edge function in this AGPL monorepo (which would
  publish the issuance policy). App-side verifier + resolver stay **TypeScript** in
  `packages/ee`. Token format changed from a bespoke bundle to a **compact JWS (`alg=EdDSA`)**
  so Go (`go-jose`) and TS (`jose`) interoperate with zero shared code; this also removes the
  RFC 8785 canonicalization step.
