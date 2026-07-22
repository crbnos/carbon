---
description: What Carbon is, its apps and key packages, the tech stack, and where things live.
paths: ["apps/**", "packages/**"]
---

# Carbon Project Overview

Carbon is a manufacturing system: an ERP (Enterprise Resource Planning), an MES
(Manufacturing Execution System / shop floor), and supporting apps. It is a
pnpm + Turborepo monorepo of `apps/*` and `packages/*`.

## Apps (`apps/*`)

- **erp** — Core manufacturing ERP. React Router v7 (flat routes). Multi-module
  business logic (sales, purchasing, inventory, operations, accounting, etc.),
  plus AI / MCP features.
- **mes** — Manufacturing Execution System (shop floor): production scheduling,
  work-center operations, real-time job tracking. React Router v7.
- **academy** — Learning / training app for onboarding. React Router v7.
- **starter** — Minimal React Router v7 starter template (auth + database + form).
- **docs** — Documentation site built with Next.js + Fumadocs (MDX). Distinct
  stack from the React Router apps.

## Packages (`packages/*`)

- **auth** — Supabase Auth + authorization: magic links, OAuth/WebAuthn/passkeys,
  permission caching, API keys. Source of the Supabase client.
- **database** — Supabase/Postgres schema, migrations, RLS policies, generated
  types, and a typed Kysely client.
- **jobs** — Inngest-powered background job orchestration (events, email/PDF
  rendering, printing, webhooks). `inngest-cli dev` for local.
- **lib** — Shared backend utilities: Inngest client, Resend email, Slack helpers,
  event definitions.
- **react** — Shared UI component library (Radix UI, TanStack Table/Virtual,
  Recharts, rich-text/editor). Grep here before writing UI.
- **form** — Form component + validation library (fields, Zod validators).
- **tiptap** — Rich-text editor built on Tiptap with extensions.
- **documents** — PDF and ZPL label/document rendering (react-pdf, react-email).
- **printing** — Print job queue, printer routing, rendering, and print UI.
- **kv** — Redis client (ioredis) with a `Ratelimit` class (sliding-window /
  fixed-window / token-bucket); rate limiting and caching.
- **locale** — i18n via Lingui v5 (multiple language catalogs, locale provider).
- **env** — Centralized environment-variable loading and validation.
- **config** — Shared build/test config (tsconfig, vitest, tailwind theme).
- **dev** — Local dev CLI (`crbn`) for environment setup and Docker / Supabase /
  Redis / Inngest orchestration; also exports a Vite plugin.
- **ee** — Enterprise-edition integrations (Slack, Jira, Linear, Xero, OnShape,
  Zapier) and accounting/exchange-rate modules.
- **stripe** — Billing: plans, checkout, subscriptions, webhooks.
- **notifications** — Notification infrastructure and types (logic mostly lives in
  auth/lib/ee).
- **utils** — Shared utilities: types, theme system, validators, cookie/CSS helpers.

`ci/` and `examples/*` are also workspace members (see `pnpm-workspace.yaml`).

## Tech stack

- **Framework**: React Router v7 (NOT Remix — the project migrated). Uses
  `remix-flat-routes` for flat-route conventions and `@vercel/react-router`.
- **UI / styling**: React 18, Radix-based `@carbon/react`, Tailwind CSS v4.
- **Database**: Supabase (Postgres) with RLS; typed access via Kysely + generated
  types from `@carbon/database`.
- **Background jobs**: Inngest (NOT Trigger.dev).
- **Cache / rate limit**: Redis via ioredis (`@carbon/kv`).
- **i18n**: Lingui v5 (`@carbon/locale`).
- **Build / tooling**: pnpm workspaces + Turborepo; Vite bundler; tsup for
  packages; Biome for lint/format; TypeScript strict; SST for infra.
- **Docs app only**: Next.js + Fumadocs + MDX.

## ERP routing & module layout

- Routes live in `apps/erp/app/routes/` using flat-route prefix dirs:
  `x+/` (authenticated app), `_public+/` (public), `api+/`, `file+/`,
  `share+/` (external/shared), plus `onboarding+/`, `select-company+/`, `mcp+/`.
- Business logic is organized into modules. A module typically has
  `.models.ts` (Zod validators), `.service.ts` (DB operations via the Supabase
  client), and UI components. Service functions follow a CRUD convention
  (e.g. `get*`, `getList*`, `upsert*`, `delete*`).
- App path helpers live in `apps/erp/app/utils/path.ts`.

## Where to look

- Root config: `package.json`, `turbo.json`, `pnpm-workspace.yaml` (pnpm catalog
  pins shared dep versions).
- App entry: `apps/<app>/app/`.
- Shared code: `packages/<name>/src/`.
