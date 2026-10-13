---
description: Stripe billing, plans, and edition/plan gating for Carbon Cloud
paths:
  - packages/stripe/**
  - packages/ee/src/plan*.ts
  - packages/database/supabase/migrations/*billing*.sql
  - apps/erp/app/routes/api+/webhook.stripe.ts
  - packages/jobs/src/inngest/functions/scheduled/weekly.ts
  - packages/jobs/src/inngest/functions/scheduled/inactive-companies.ts
  - packages/jobs/src/inngest/functions/scheduled/purge-company.ts
---

# Billing System

Stripe-backed subscription billing. **Only active on the Cloud edition.** Self-hosted
(Enterprise/Community) and bypass-listed companies skip all billing/plan checks.

## Editions & Plans (`packages/utils/src/types.ts`)

`enum Edition { Cloud, Enterprise, Community, Test }` — runtime value read from the
`CARBON_EDITION` env var, exposed as `CarbonEdition` (`packages/env/src/index.ts`).

`enum Plan { Starter="STARTER", Business="BUSINESS", Partner="PARTNER", Unknown="UNKNOWN" }`.
DB stores partner tiers as `PARTNER-300/400/500`; `normalizePlanId(planId)` collapses any
`PARTNER*` onto `Plan.Partner` so `requirement.includes(plan)` matches. Null/unknown → `Plan.Unknown`.

## Schema (newest: `20250619100940_billing.sql`; RLS in `20260228000000_rls-refactor-3.sql`)

Three tables. No `subscription`/`companySubscription` table exists — subscription state lives
on `companyPlan`.

- **`plan`** — plan catalog. Cols: `id` (natural key, e.g. `'STARTER'`), `name`,
  `userBasedPricing` BOOL (per-seat vs flat fee), `stripePriceId` (UNIQUE), `tasksLimit`
  (10000), `aiTokensLimit` (1000000), `stripeTrialPeriodDays` (default 7; seeded plans use 30),
  `public` BOOL. RLS SELECT: any authenticated user.
- **`companyPlan`** — one row per company; `id` **is** the company id (FK → `company.id`).
  Cols: `planId` (FK → `plan.id`), `tasksLimit`/`aiTokensLimit`/`usersLimit`,
  `subscriptionStartDate`, `stripeCustomerId`, `stripeSubscriptionId`,
  `stripeSubscriptionStatus` (default `'Active'`), `trialPeriodEndsAt`. RLS: company-scoped.
- **`companyUsage`** — metering. Cols: `users`, `tasks`, `aiTokens`, `nextResetDatetime`,
  `companyId` (FK). RLS: company-scoped.

### Seeded plans (production price IDs, from the migration)

| id | name | userBasedPricing | public | stripePriceId |
|----|------|------------------|--------|---------------|
| STARTER | Cloud Starter | true | true | `price_1RgUYhFV6ecOa0XvD37hQOhK` |
| BUSINESS | Cloud Business | true | true | `price_1RjLE1FV6ecOa0Xv0kmTHWPu` |
| PARTNER-400 | Design Partner | false | false | `price_1RgXMSFV6ecOa0XvLQtlhQr0` |
| PARTNER-300 | Design Partner | false | false | `price_1Rj20jFV6ecOa0Xvk4WV6b7l` |
| PARTNER-500 | Design Partner | false | false | `price_1Rj21OFV6ecOa0XvCTdELYdv` |

Test-mode price overrides (3 only — STARTER, BUSINESS, PARTNER-400) live in
`packages/database/src/seed/stripe.ts` (`devPrices`).

## Stripe package (`packages/stripe/src/stripe.server.ts`)

Exported via `@carbon/stripe/stripe.server`. Client created with apiVersion `2025-06-30.basil`;
`stripe` is `null` when `STRIPE_SECRET_KEY` is unset (non-Cloud). Key functions:

- `getCheckoutUrl({ planId, userId, companyId, email, name })` — creates a checkout session (with trial).
- `getBillingPortalRedirectUrl({ companyId, priceIds? })` — self-service portal URL.
- `createStripeCustomer(...)`, `getStripeCustomerId(companyId)`, `getStripeCustomerByCompanyId(companyId, userId)`.
- `processStripeEvent({ body, signature })` — verifies signature, dispatches webhook events.
- `syncStripeDataToKV(customerId, companyIdFromMetadata?)` — the **single source-of-truth sync**:
  pulls subscription state into Redis and upserts `companyPlan`. Subscription delete removes the
  Redis cache and the `companyPlan` row.
- `updateActiveUsers(...)` / `updateSubscriptionQuantityForCompany(companyId)` — for `userBasedPricing`
  plans, sets Stripe subscription quantity to the active user count (excludes `@carbon.ms` emails).
- `forwardToGtm(...)` in `gtm-events.server.ts` — forwards invoice events to GTM.

Stripe state is cached in **Redis** keyed by customer; `companyPlan` is the durable mirror.

## Webhook (`apps/erp/app/routes/api+/webhook.stripe.ts`)

`action` (POST): requires a `stripe-signature` header (400 if missing), calls
`processStripeEvent`. `loader` (GET): re-syncs the current company's customer via
`getStripeCustomerId` → `syncStripeDataToKV`, then redirects to the authenticated root.

Events handled (see `processStripeEvent`): `checkout.session.completed` (+ `async_payment_succeeded`),
the `customer.subscription.*` family (`created/updated/deleted/paused/resumed/trial_will_end/...`),
the `invoice.*` family, and `payment_intent.*`. Most mutate state via `syncStripeDataToKV`;
several `invoice.*` events are forwarded to GTM.

## Plan gating (`packages/ee/src/plan.ts` + `plan.server.ts`)

`FEATURE_PLANS` (`plan.ts`) is the source of truth — both client and server read it:
`API_KEYS, WEBHOOKS, MCP, INTEGRATIONS, SALES_RULES, AUDIT_LOG, EMAIL_NOTIFICATIONS, STORAGE_RULES,
CUSTOMER_PORTALS, AI_AGENT, WORKFLOWS, FORECAST, TWO_FACTOR, PERMISSIONS, APPROVAL_RULES,
BACKUPS` → each `[Plan.Business, Plan.Partner]`. `INTEGRATION_WHITELIST` (`email`) bypasses
the `INTEGRATIONS` gate. `MCP` gates the MCP server (`POST /api/mcp`) via
`companyHasFeature` at the route choke point — off on Community/Starter across both the
OAuth-connector and `carbon-key` auth paths (`api+/mcp+/_index.ts`).

`APPROVAL_RULES` gates the `x+/settings+/approval-rules.*` routes (via `requireFeature`
+ hidden nav); the runtime approval engine (`$supplierId.approval`, request/approve/reject)
stays ungated — a Community company just has no rules to trigger it. `BACKUPS` gates the
company backup/restore feature, but through `canManageBackups`
(`~/modules/settings/backups.server`) = `canAccessBackups(email) ||
companyHasFeature(BACKUPS)` — i.e. Business/Enterprise customers get it AND internal staff
/ local dev keep the escape hatch. Demo Data (`x+/settings+/demo-data`) stays internal /
local-dev only via the plain `canAccessBackups`.

`PERMISSIONS` gates authoring RBAC — creating/editing employee types
(`x+/users+/employee-types*`), editing an individual user's permissions
(`employees.$employeeId`, `bulk-edit-permissions`), and console/kiosk mode
(`x+/settings+/people.tsx`). The licensed logic — the flattened-permission-object
builder `updatePermissions`, `updateEmployee`, the employee-type CRUD, and the
claims/employee-type translators — lives once in **`@carbon/ee/permissions.server`**
(consumed by the ERP authoring routes AND the `@carbon/jobs` bulk-edit task, which
no longer carries its own copy). Console-operator provisioning is `@carbon/ee/console.server`
(`updateConsoleSetting`); the authoring UI is `.ee.tsx` in the app (it can't move
to the package — it imports `~/components/Form` etc.).
The community primitives it does NOT include — `setUserPermissions` (invite merge)
and `makePermissionsFromEmployeeType` (invite snapshot) — stay in the app's
`users.server.ts`. Community/Starter ships "everyone is an admin": you can add
users (every invite defaults to the seeded `Admin` employee type) but not author
roles. Enforcement (`requirePermissions`, RLS, `get_claims`) is unaffected and
stays in every edition.

Server checks (`plan.server.ts`) read `companyPlan.planId` through `getCompanyPlanId`
(`@carbon/auth/company.server`), the one cached reader the API-key plan gate in
`requirePermissions` also uses: service role, Redis for 5 minutes, memoized per read request.
A company with no plan row is cached too (as `""`), and so is the `isCarbonOwnedCompany`
fallback such a company falls through to. `syncStripeDataToKV` clears the plan key when
it writes a row; a failed read is never cached. Any other change (a plan row edited by
hand, the `customer.subscription.deleted` webhook, a group owner change) shows up within
5 minutes, or at once after `DEL companyPlan:<companyId>` in Redis.

- `companyHasPlan(client, companyId, spec)` → boolean.
- `requirePlan({ request, client, companyId, redirectTo, message?, ...spec })` → throws a
  `redirect` with a flash error when the gate fails.
- `getPlan(client, companyId)` → the raw plan id string the **client** gate
  (`usePlan`) consumes, resolved from the SAME durable `companyPlan` mirror the two checks
  above read (precedence bypass → `companyPlan` → carbon-owned; `null` off Cloud). The `/x`
  loader calls this for its `plan` field. It exists so the UI gate can never disagree with
  server enforcement — the loader previously sourced `plan` from `getStripeCustomerByCompanyId().planId`
  (the Stripe/Redis cache), which could go stale and gate a customer whose real plan was
  correct (a live Partner shown "Upgrade to Business", API keys hidden, while the API auth
  path — reading `companyPlan` directly — still accepted the keys).

**All three short-circuit when `CarbonEdition !== Edition.Cloud` or the company is
bypass-listed** — plan gating only bites on Cloud. This is a **self-hosted feature
toggle**: Enterprise AND Community self-hosted both pass `companyHasPlan`.

### `companyHasFeature` / `requireFeature` — Community is blocked, not toggled

For features that must be OFF on the **Community** edition (not merely paywalled on
Cloud) — RBAC authoring (`PERMISSIONS`), console/kiosk mode — use
`companyHasFeature(client, companyId, spec)` / `requireFeature({...})` instead.
They are identical to `companyHasPlan`/`requirePlan` EXCEPT they return
`false`/throw when `CarbonEdition === Edition.Community`. So: Community → blocked,
Enterprise/Test self-hosted → allowed (licensed), Cloud → plan-based,
bypass/carbon-owned → allowed. `requirePlan`'s off-Cloud no-op is wrong for these
— it would let a self-hosted Community instance author roles.

`spec` is a `GateSpec`: either `{ feature: Feature }` or `{ plan: Plan | Plan[] }`.

## Frontend hooks (`packages/react/src/hooks/`)

- `usePlan()` (`usePlan.tsx`) — reads `plan` from the `/x` route data and runs it through
  `normalizePlanId`. The `/x` layout loader sources it from `getPlan` (the durable
  `companyPlan` mirror), NOT the Stripe customer cache — see Plan gating above.
- `useEdition()` (`useEdition.tsx`) — reads `env.CARBON_EDITION` from root route data.
- `usePlanGate` (client mirror of `FEATURE_PLANS`).

## Bypass mechanism

Env: `STRIPE_BYPASS_COMPANY_IDS`, `STRIPE_BYPASS_USER_IDS` (comma-separated, server-only).
- In gating: `isBypassCompany(companyId)` makes `companyHasPlan`/`requirePlan` pass.
- In `getStripeCustomerByCompanyId`: bypass returns a synthetic active subscription with
  `planId: Plan.Partner` (highest tier, ~1-year period) — no real Stripe call.

## Inactive-company cleanup (Cloud only)

The weekly job (`packages/jobs/.../scheduled/weekly.ts`, Sunday 21:00 UTC) deletes
companies that stopped paying. Until 2026-09 it never deleted anything: it fetched its
bypass list from a scheme-less `VERCEL_URL` and failed. Each run logs whom it warned and
whom it deleted.

- **Warned first, always.** A company that has never been warned gets a
  `CompanyDeletionWarningEmail` (`@carbon/documents/email`) sent to its group owner, naming
  the deletion date, and a marker row in `externalIntegrationMapping`
  (`integration = "inactive-company-warning"`, `metadata.warnedAt`).
  - The marker also stores `deleteAfter`, the UTC date the email names (today + 7). The
    company is deleted at the first run on or after that date, never before
    (`isDueForDeletion`, tested). A warning retried after UTC midnight therefore names,
    and waits for, the later date.
  - A company with no group owner is never warned, so it is never deleted. It is also
    left out of the capped lists, where it would otherwise hold a slot every week.
  - A failed send is recorded as `metadata.failedAt`, and that company queues behind
    the never-tried ones next week, so a bad address cannot starve the rest.
  - A warning expires after 30 days, and the company is warned again. A marker whose
    company is no longer inactive (it bought a plan) is cleared, so a later lapse starts
    a fresh warning. The purge deletes the marker along with the company.
  - Right before each purge, `isStillDueForDeletion` re-reads, inside the purge's own
    transaction, the company, the group's plan rows, the bypass list, the group owner and
    the warning. The marker stores the warned owner's id (`ownerId`); the purge requires
    the group's current owner to be that same person. A plan bought, or an owner cleared
    or changed, after the warning stops the delete.
  - Each warn or delete batch that still fails after its retries is logged and skipped.
    It never ends the run, so the training reminders after it still go out.

- **One exception to "warned first": the manual purge.** `purge-inactive-companies`
  (`scheduled/purge-inactive-companies.ts`) runs only when someone presses Invoke on it
  in the Inngest dashboard, on Carbon Cloud. `purgeRefusal` (tested) is the first thing
  the run checks: any edition but Cloud is refused, and so is any run whose event is not
  `inngest/function.invoked`, so sending `carbon/purge-inactive-companies` with the event
  key does nothing. Off Cloud the function is not registered at all
  (`packages/jobs/src/inngest/index.ts`). It deletes inactive
  companies immediately, with no email and no waiting period, including ones the weekly
  job warned for a later date. The inactivity rule is the weekly job's, unchanged
  (`loadInactiveCompanies` and the in-transaction `inactiveCompanyOwner`, both in
  `scheduled/company-cleanup.ts`, shared by the two). It is a DRY RUN unless the payload
  says `{ "dryRun": false }` (`resolvePurgeOptions`, tested): an Invoke with an empty
  payload returns the companies it would delete and deletes none. `limit` caps a run, 500
  at most. An ownerless company is still never deleted.
- **Caps.** Both paths handle at most 500 companies a run, ten per Inngest step
  (`MAX_COMPANY_DELETIONS_PER_RUN`, `MAX_COMPANIES_PER_RUN`).

- **The group is the unit** (`selectInactiveCompanies`, `inactive-companies.ts`, tested).
  A company goes when it has no `companyPlan` row, no company in its group has one, it is
  over 7 days old, and it is not protected. `companyPlan` rows are written only by Stripe
  checkout/sync. A paying customer's second company (Settings → New Company) has no row of
  its own, and bypass and Carbon-owned access is served without one.
- **Protected:** `STRIPE_BYPASS_COMPANY_IDS`, plus any group whose owner is in
  `STRIPE_BYPASS_USER_IDS` or has an internal email (the `isCarbonOwnedCompany` rule).
- **`Canceled` is not deleted.** It is set when the customer cancels at period end, while
  the period is still paid. `customer.subscription.deleted` removes the plan row when the
  subscription actually ends, and the company becomes a candidate then.
- **Deletion** (`purgeCompany`, `purge-company.ts`):
  - Posted journals and invoices are trigger-immutable, so a plain `DELETE FROM company`
    fails for any company that ever posted. The purge instead wipes every catalog table in
    `session_replication_role = 'replica'`, as a restore does, then deletes the company.
    The group and its shared data go only when no other company is left in it.
  - Without replica permission it falls back to the plain cascade. A company with posted
    documents then fails, and is logged and skipped. So does the last company in a group,
    because its group's system accounts refuse deletion and the group would be stranded.
  - BEFORE the transaction, `removeCompanyFiles` drains and deletes the per-company
    bucket (already missing counts as done) and legacy files under `private/<companyId>/`
    (listed strictly, so a listing error is a failure). Never inside it: storage deletes
    its object rows on its own connection, `delete_orphaned_documents` then deletes the
    matching `document` rows, and when the open purge transaction has already deleted
    those rows storage waits on it until it times out (HTTP 544) and the purge rolls
    back. The bucket is drained by listing, not `emptyBucket`, which only queues the
    deletes and so makes the `deleteBucket` after it fail as "not empty". Any failure
    keeps the company (the row is the retry target); `stillDue` is asked before the
    files go and again in the transaction. `removeCompanySecrets` (the Vault
    `integration:<companyId>:*` secrets) is plain SQL and stays inside the transaction.
    A company whose cleanup failed part-way may have
    lost some files; it is still warned and due, so the next run finishes it. The search
    index and audit log tables (`searchIndex_<id>`, `auditLog_<id>`: named after the
    company, so outside the catalog) are dropped after the commit by `deleteCompanies`
    (`company-cleanup.ts`), and a failure there is only logged. Provider
    tokens are not revoked at the provider.
- At most 500 companies per run (Inngest's per-run step limit), 10 per step. Oldest go first.
- A company with live intercompany history (`intercompanyTransaction` is NO ACTION) fails
  its delete, is logged, and is retried every week.

## Env vars (`packages/env/src/index.ts`, server-only / secret)

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (both optional — Cloud only),
`STRIPE_BYPASS_COMPANY_IDS`, `STRIPE_BYPASS_USER_IDS`. Re-exported from `@carbon/auth`.
`STRIPE_CONNECT_WEBHOOK_SECRET` also lives here but belongs to Stripe **Connect**
(customer payments on connected accounts), not to Carbon's own billing — see
`packages/stripe/src/connect.server.ts` and `webhook.stripe-connect.ts`.

## Gotchas

- Don't add subscription-status logic outside `syncStripeDataToKV` — it's the one writer of
  `companyPlan` from Stripe; the webhook and the GET re-sync both funnel through it.
- `companyPlan.id == company.id` (not an `id('cplan')` value); query by `.eq("id", companyId)`.
- Plan rows use the natural key as `id` (`'STARTER'`, `'PARTNER-300'`); always `normalizePlanId`
  before comparing against the `Plan` enum.
- Gating is a no-op off Cloud — test plan logic with `CARBON_EDITION=cloud` and a non-bypassed company.
