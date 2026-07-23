# Environment variables

> Every variable that configures a Carbon instance, grouped by concern. The source of truth is packages/env.

Carbon reads its configuration from environment variables. The registry lives in `packages/env`;
`.env.example` is the template; infrastructure-only variables are read by `sst.config.ts`. A minimal
instance needs the Supabase connection, a session secret, and Redis. Everything else activates features
as you need them.

## Core

Platform-wide behavior and edition.

One of `community`, `cloud`, `enterprise`, or `test`. Gates edition-specific features.
Enables ITAR / controlled-environment restrictions.
Allowed sign-in methods: `email`, `google`, `azure`, `passkey`.
Base domain the apps are served from.
Public URL of the ERP app.
Public URL of the MES app.
Default UI language.
Requests per window allowed against the API.

## Database — Supabase

Carbon's single Postgres database. All five are required.

Supabase project URL.
Public anon key, browser-safe.
Service-role key, server only, never exposed to the client.
Direct Postgres connection string.
Secret used to sign and verify session JWTs.

## Auth & sessions

Signs the session cookie.
Google OAuth client id, when `google` is in `AUTH_PROVIDERS`.
Google OAuth client secret.
Azure OAuth client id, when `azure` is enabled.
Azure OAuth client secret.
Local only. Sign in as this email without a magic link.

Sign-in bot protection uses Cloudflare Turnstile: `CLOUDFLARE_TURNSTILE_SITE_KEY` and
`CLOUDFLARE_TURNSTILE_SECRET_KEY`.

## Jobs & cache

Redis connection (ioredis URL) for the permission cache and queues.
Signs requests to the Inngest jobs runner. Required in production.
Key for sending events to Inngest. Required in production.
Override the Inngest endpoint (self-hosted or dev).

`INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are only optional in development, where `INNGEST_DEV=1` is set. Without `INNGEST_DEV`, the app fails to boot if either is missing, and no background jobs (MRP, scheduling, notifications, integration syncs) or queued events run. A self-hosted Inngest server supplies both. The Docker with Caddy recipe generates them for you.

## Email & billing

Resend API key for transactional email.
Verified sending domain.
Stripe secret key, Cloud / Enterprise billing.
Verifies inbound Stripe webhooks.

## AI & analytics

Powers AI features (embeddings, assist).
Anthropic key for Claude-backed features.
PostHog host for product analytics.
PostHog project key.

## Integrations

OAuth credentials for each connector, all optional, set only the ones you use.

Xero OAuth client id.
Xero OAuth client secret.
Verifies inbound Xero webhooks.
QuickBooks OAuth client id.
QuickBooks OAuth client secret.
Jira OAuth client id.
Jira OAuth client secret.
Slack OAuth client id.
Slack OAuth client secret.
Onshape OAuth client id.
Onshape OAuth client secret.
Currency exchange-rate feed.
Address autocomplete.

## Infrastructure — SST

Read by `sst.config.ts` at deploy time, not by the app.

Region to deploy into.
Target AWS account.
ECR image tag to deploy.
ACM certificate ARN for the ERP domain.
ACM certificate ARN for the MES domain.
Custom ERP domain, overrides the default.
Custom MES domain, overrides the default.

Older notes list `TRIGGER_*` (Trigger.dev) and `UPSTASH_REDIS_*` variables. Those are gone. Jobs run on
Inngest and the cache uses a plain `REDIS_URL`.
