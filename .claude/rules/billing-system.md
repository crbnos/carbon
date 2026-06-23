---
description: Stripe billing, plans, and edition/plan gating for Carbon Cloud
paths:
  - packages/stripe/**
  - packages/ee/src/plan*.ts
  - packages/database/supabase/migrations/*billing*.sql
  - apps/erp/app/routes/api+/webhook.stripe.ts
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
`API_KEYS, WEBHOOKS, INTEGRATIONS, ITEM_RULES, AUDIT_LOG, EMAIL_NOTIFICATIONS, STORAGE_RULES,
CUSTOMER_PORTALS` → each `[Plan.Business, Plan.Partner]`. `INTEGRATION_WHITELIST`
(`email`, `exchange-rates-v1`) bypasses the `INTEGRATIONS` gate.

Server checks (`plan.server.ts`) read `companyPlan.planId` (`.eq("id", companyId)`):

- `companyHasPlan(client, companyId, spec)` → boolean.
- `requirePlan({ request, client, companyId, redirectTo, message?, ...spec })` → throws a
  `redirect` with a flash error when the gate fails.

**Both short-circuit `true`/return when `CarbonEdition !== Edition.Cloud` or the company is
bypass-listed** — gating only bites on Cloud.

`spec` is a `GateSpec`: either `{ feature: Feature }` or `{ plan: Plan | Plan[] }`.

## Frontend hooks (`packages/react/src/hooks/`)

- `usePlan()` (`usePlan.tsx`) — reads `plan` from the `/x` route data and runs it through
  `normalizePlanId`. The `/x` layout loader sources it from the Stripe customer's `planId`.
- `useEdition()` (`useEdition.tsx`) — reads `env.CARBON_EDITION` from root route data.
- `usePlanGate` (client mirror of `FEATURE_PLANS`).

## Bypass mechanism

Env: `STRIPE_BYPASS_COMPANY_IDS`, `STRIPE_BYPASS_USER_IDS` (comma-separated, server-only).
- In gating: `isBypassCompany(companyId)` makes `companyHasPlan`/`requirePlan` pass.
- In `getStripeCustomerByCompanyId`: bypass returns a synthetic active subscription with
  `planId: Plan.Partner` (highest tier, ~1-year period) — no real Stripe call.

## Env vars (`packages/env/src/index.ts`, server-only / secret)

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (both optional — Cloud only),
`STRIPE_BYPASS_COMPANY_IDS`, `STRIPE_BYPASS_USER_IDS`. Re-exported from `@carbon/auth`.

## Gotchas

- Don't add subscription-status logic outside `syncStripeDataToKV` — it's the one writer of
  `companyPlan` from Stripe; the webhook and the GET re-sync both funnel through it.
- `companyPlan.id == company.id` (not an `id('cplan')` value); query by `.eq("id", companyId)`.
- Plan rows use the natural key as `id` (`'STARTER'`, `'PARTNER-300'`); always `normalizePlanId`
  before comparing against the `Plan` enum.
- Gating is a no-op off Cloud — test plan logic with `CARBON_EDITION=cloud` and a non-bypassed company.
