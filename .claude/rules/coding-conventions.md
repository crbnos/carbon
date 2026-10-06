---
paths:
  - "apps/**"
  - "packages/**"
---

# Coding Conventions (General)

Cross-cutting conventions for the whole repo. For deep dives, load the focused
rules — this file does not repeat them:

| Topic | Rule |
|-------|------|
| DB / migrations / RLS / multi-tenancy | [conventions-database.md](conventions-database.md) |
| ValidatedForm + zod validators + actions | [conventions-forms.md](conventions-forms.md) |
| Service functions (`{module}.service.ts`) | [conventions-services.md](conventions-services.md) |
| Components, animation, polish | [conventions-ui.md](conventions-ui.md) |

## Stack & Tooling

- **Monorepo**: pnpm workspaces. Workspaces are `apps/*` and `packages/*`
  (also `ci`, `examples/*`). See root `package.json` / `pnpm-workspace.yaml`.
- **Framework**: **React Router v7** (NOT Remix). Apps `apps/erp` and `apps/mes`
  build with `react-router build`. Routing uses `remix-flat-routes`.
- **Language**: TypeScript everywhere. **Never hand-edit generated DB types.**
- **License header**: every source file opens with an SPDX header — `AGPL-3.0-only`,
  or `LicenseRef-Carbon-Commercial` under `packages/ee/` and in `.ee.` files
  (`spdx-license-header` check). Write it with `pnpm --filter @carbon/checks
  license-headers`; moving a file across that boundary means swapping it
  (see [commercial-licensing.md](commercial-licensing.md)).
- **Backend data**: Supabase client (`SupabaseClient<Database>`) for most reads/
  writes; Kysely for multi-row transactions (see services/database rules).

## Imports

- `~/*` → app code, mapped to `./app/*` in each app's `tsconfig.json`
  (e.g. `import { usePermissions } from "~/hooks"`).
- `@carbon/*` → pnpm workspace packages under `packages/`. Real packages include:
  `@carbon/react`, `@carbon/form`, `@carbon/auth`, `@carbon/database`,
  `@carbon/utils`, `@carbon/documents`, `@carbon/jobs`, `@carbon/printing`,
  `@carbon/notifications`, `@carbon/stripe`, `@carbon/tiptap`, `@carbon/kv`,
  `@carbon/lib`, `@carbon/locale`, `@carbon/ee`, `@carbon/env`, `@carbon/config`.
- `react-router` is the framework import for `LoaderFunctionArgs`,
  `ActionFunctionArgs`, `data`, `useNavigate`, etc. — but NOT `redirect`.
- `redirect` comes from `@carbon/utils`. It only goes to a path on this origin;
  anything else (an absolute URL, `//host`, an empty value) lands on the home
  page, so a destination read from a query string or a form needs no validation
  at the call site. Leaving the origin on purpose (OAuth provider, Stripe, ERP ↔
  MES) is `redirectExternal`, with a URL the server built. Enforced by the
  `no-raw-redirect` check (`@carbon/checks`).
- Server-only auth helpers come from subpaths:
  `@carbon/auth/auth.server` (`requirePermissions`), `@carbon/auth/session.server`
  (`flash`), and `@carbon/auth` (`error`, `success`, `assertIsPost`).

```typescript
import { Button, VStack } from "@carbon/react";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { usePermissions } from "~/hooks";
```

## App Module Layout

ERP feature code is organized by module under `apps/erp/app/modules/{module}/`:

```
modules/{module}/
├── {module}.models.ts    # zod validators + derived types
├── {module}.service.ts   # Supabase/Kysely data operations
├── {module}.server.ts    # server-only helpers (optional)
├── types.ts              # shared types (optional)
├── index.ts              # barrel: re-exports models/service/types
└── ui/                   # feature components
```

`index.ts` is a barrel of `export * from "./..."` (see
`apps/erp/app/modules/sales/index.ts`). Import from the module root
(`~/modules/sales`), not deep files.

**Folder names are kebab-case.** Multi-word directories use hyphens, not
camelCase — `packages/ee/src/paperless-parts`, `packages/ee/src/rules` (not
`paperlessParts`). This applies to modules and package subdirs. The `ui/`
feature groupings inside a module are the exception: they are PascalCase and
match the feature (`ui/StorageRules/`, `ui/SalesRules/`, `ui/WarehouseTransfers/`),
as are the React component filenames inside them (`StorageRuleForm.tsx`). The
`{module}.*.ts` service/model file prefixes mirror their folder name.

**A feature is not automatically a module.** A module is a business domain, and
it owns exactly one `{module}.models.ts` / `{module}.service.ts` pair. Sub-features
live *inside* their domain module as a `ui/{Feature}/` folder plus functions in
that one service/models file — e.g. storage rules live in `~/modules/inventory`
and sales rules in `~/modules/sales`, not in standalone `modules/storage-rules` /
`modules/sales-rules` directories. Create a new module only for a genuinely new
domain.

MES is lighter: services live under `apps/mes/app/services/`, components under
`apps/mes/app/components/`.

## Routes

- File-based via `remix-flat-routes`. Conventions seen in `apps/*/app/routes/`:
  `_index.tsx`, `_layout.tsx` and `_public+/` (pathless), `x+/`, `api+/`, `file+/`
  (folder groups), `$param` (dynamic segments), `[.]pdf` (escaped literals).
- Loaders/actions destructure args typed by `react-router`; the first thing an
  authenticated handler does is `await requirePermissions(request, { ... })`,
  destructuring `{ client, companyId, userId }` (also `email`, `companyGroupId`).
- Loaders/actions return **plain objects** or `data(value, responseInit)`.
  Do NOT use `json(...)` — that is the old Remix helper and is not the convention here.
- A layout does NOT export `shouldRevalidate` to skip its loader. Single fetch
  re-runs every matched loader on every navigation, and that is what keeps a page
  correct after a save, a redirect or another user's change. The skip was tried
  (2026-10-01 to 2026-10-06, 186 layouts) and removed: it depended on what React
  Router passes along, which is lost on a second redirect, and on realtime covering
  every table a layout reads. A slow layout loader is made faster (one query, the
  direct connection, work shared through middleware context), not skipped. The two
  exceptions are the root (same-pathname navigations) and the app shell (re-runs
  after five minutes), whose data does not change with the record on screen.
  Shell data that does not gate rendering is returned as a promise
  and read with `useResolved` (`~/hooks/useResolved`) when a late value is harmless.
  Data that adds or removes something on first paint (a nav item, a card) is awaited
  instead: streamed in, it arrives after the page is drawn and pushes it around — the
  Implementation Hub's nav item and home card did exactly that. Await only the part
  that decides whether the thing exists (the hub row) and stream what fills it in
  (its progress), holding the layout until it lands.
  `useResolved` keeps the last value while a revalidation is pending, so a
  component that stays mounted across records passes the record id as its third
  argument (`useResolved(promise, null, itemId)`), or it shows the previous record's
  value until the new one arrives.
- A route under `/x` renders `<RecordOutlet />` from `@carbon/react`, never a plain
  `<Outlet />`. React Router keeps a page mounted when only its params change, so
  a form's default values, an editor's content or a `useState` copy would stay the
  previous record's. `RecordOutlet` remounts the page for another record and
  leaves it mounted when a drawer opens over it. Enforced by `no-bare-outlet`.
- An index route that only redirects (`/x/issue/:id` → `…/details`, a module root →
  its first page) also exports `middleware = [redirectBeforeLoaders(loader)]` from
  `@carbon/utils`. The loaders of a matched branch run in parallel, so without it every
  parent loader runs for a request that is about to be redirected. Enforced by the
  `index-redirect-before-loaders` check (`@carbon/checks`).
- On success an action throws a redirect (`throw redirect(...)`), not `return`.
  A cached `api+` loader exports `clientLoader = cachedClientLoader<typeof loader>()`;
  no route exports a `clientAction`.

## Errors: always log before you throw

- Never throw (or return) an error without logging it first. Declare a module
  logger, `const logger = getLogger("erp", "<route-or-module>")` from
  `@carbon/logger`, and call `logger.error("<what failed>", { companyId, ...context, error })`
  before `throw new Response(...)` / `throw new Error(...)`.
- Why: a thrown `Response` from a loader/action goes straight to the client;
  React Router skips `handleError` for it, so an unlogged throw leaves no server trace.
- Also log failures you deliberately swallow (best-effort cleanup, ignored
  `{ error }` results, `.catch(() => {})`).
- Redirects (`throw redirect(...)`) are control flow, not errors; no log needed.

## Components & UI Library

- Reach for `@carbon/react` (barrel export at `packages/react/src/index.tsx`) and
  form fields from `~/components/Form` (re-exports `@carbon/form` + domain
  selectors) before writing custom UI. Prefer built-in variants over ad-hoc
  `bg-*`/`text-*` classes.
- App-level shared components live in `apps/erp/app/components/` and are
  re-exported from its `index.ts`.
- A component or hook both ERP and MES need lives in a package (`@carbon/react`,
  `@carbon/auth`, `@carbon/utils`), not as a copy in each app. An app file of the
  same name may only re-export it. Enforced by the `no-duplicated-app-file` check
  (`@carbon/checks`); the copies that predate it are baselined.
- Functional components, props typed inline or via `type`/`z.infer<typeof validator>`.
- Do not seed `useState` from loader or route data: it is a copy that no reload
  updates. Compute a derived value during render; keep only the user's own input
  in state and combine it with the current data. Do not add an effect that copies
  the data in again. Enforced, for a hook result used in the same file, by
  `no-state-copy-of-loader-data` (`@carbon/checks`).
- Styling is Tailwind. Theme colors are CSS variables — use `hsl(var(--primary))`
  for theme-aware fills (e.g. Recharts), not hard-coded colors.

## Validators

- zod, imported as `import { z } from "zod"`, with `zfd` from `zod-form-data`
  for FormData coercion: `zfd.text(...)`, `zfd.numeric(...)`, `zfd.checkbox()`.
- Validate in route actions with `validator(schema).validate(formData)` from
  `@carbon/form` — not `schema.parse()`. Full pattern in conventions-forms.md.

## State

- **Server state / route data**: React Router loaders.
- **Client cache of server data**: TanStack Query through `@carbon/query`. A
  cached `api+` loader is `cachedClientLoader<typeof loader>()`, keyed by its
  URL; components read with `useLoaderQuery(url)`; the root middleware
  invalidates after every mutation. No hand-written query keys
  (see `clientAction-patterns.md`).
- **Realtime**: private broadcast topics through `@carbon/query`. A route
  declares its tables in `handle.realtime`; the live lists (`useItems`,
  `useCustomers`, `useSuppliers`, `usePeople`) are queries kept current by
  `LiveLists` (see `realtime-system.md`).
- **Global UI state**: zustand (`apps/erp/app/stores/ui.ts`). nanostores is
  gone from the repo.

## Path Helpers

URLs are generated through the typed `path` helper at `apps/erp/app/utils/path.ts`
(`import { path } from "~/utils/path"`). Use `path.to.*` instead of hardcoded
URL strings in links, redirects, and form actions.

## Theme System

Themes are defined in `packages/utils/src/themes.ts` and selected via the
`useTheme()` hook (`apps/erp/app/hooks/useTheme.tsx`). Each theme supplies HSL
values for CSS variables (`--primary`, `--background`, `--foreground`, `--card`,
`--popover`, `--secondary`, `--muted`, `--accent`, `--destructive`).
Theme names: `zinc`, `neutral`, `red`, `orange`, `yellow`, `green`, `blue`,
`violet`. <!-- UNVERIFIED: display labels like "Modern"/"Brutal"/"Cherry" not re-confirmed in current code -->
