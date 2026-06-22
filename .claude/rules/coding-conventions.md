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
  `ActionFunctionArgs`, `redirect`, `data`, `useNavigate`, etc.
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
camelCase — `modules/storage-rules`, `packages/ee/src/storage-rules` (not
`storageRules`). This applies to all directories (modules, package subdirs,
`ui/` groupings). React components inside still use PascalCase filenames
(`StorageRuleForm.tsx`); the `{module}.*.ts` service/model file prefixes mirror
their folder name.

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
- On success an action throws a redirect (`throw redirect(...)`), not `return`.
  Cached entities add a `clientAction`/`clientLoader` for cache control.

## Components & UI Library

- Reach for `@carbon/react` (barrel export at `packages/react/src/index.tsx`) and
  form fields from `~/components/Form` (re-exports `@carbon/form` + domain
  selectors) before writing custom UI. Prefer built-in variants over ad-hoc
  `bg-*`/`text-*` classes.
- App-level shared components live in `apps/erp/app/components/` and are
  re-exported from its `index.ts`.
- Functional components, props typed inline or via `type`/`z.infer<typeof validator>`.
- Styling is Tailwind. Theme colors are CSS variables — use `hsl(var(--primary))`
  for theme-aware fills (e.g. Recharts), not hard-coded colors.

## Validators

- zod, imported as `import { z } from "zod"`, with `zfd` from `zod-form-data`
  for FormData coercion: `zfd.text(...)`, `zfd.numeric(...)`, `zfd.checkbox()`.
- Validate in route actions with `validator(schema).validate(formData)` from
  `@carbon/form` — not `schema.parse()`. Full pattern in conventions-forms.md.

## State

- **Server state / route data**: React Router loaders.
- **Client read-through cache**: TanStack React Query (`window.clientCache`);
  query keys are company-scoped, e.g. `["things", companyId]`
  (`apps/erp/app/utils/react-query.ts`).
- **Global UI state**: nanostores atoms + `@nanostores/react`
  (e.g. `apps/erp/app/stores/items.ts`).

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
