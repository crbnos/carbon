---
paths:
  - "apps/**"
  - "packages/**"
---

# Carbon Conventions Index

Quick-reference pointer for Carbon-specific patterns. Load the focused rule for
the area you're touching — it has the full detail, this file does not repeat it.

## Convention rules

| Area | Rule | Load when |
|------|------|-----------|
| Stack, imports, module layout, routes, state | [coding-conventions.md](coding-conventions.md) | General orientation |
| What Carbon is, apps & packages | [project-overview.md](project-overview.md) | Finding where things live |
| Migrations, RLS, multi-tenancy, Kysely transactions | [conventions-database.md](conventions-database.md) | Schema / DB changes |
| `ValidatedForm` + zod validators + route actions | [conventions-forms.md](conventions-forms.md) | Building forms |
| Service functions (`{module}.service.ts`) | [conventions-services.md](conventions-services.md) | DB read/write helpers |
| Components, animation, polish | [conventions-ui.md](conventions-ui.md) | UI work |

Many subsystem rules (e.g. `database-patterns.md`, `event-system.md`,
`printing-system.md`, `authentication-system.md`, `mrp-system.md`) live as
siblings in this directory — grep `.claude/rules/` by topic.

## Always-true facts

- **Monorepo**: pnpm workspaces + Turborepo. Workspaces are `apps/*` and
  `packages/*` (also `ci`, `examples/*`). Dep versions pinned via pnpm catalog.
- **Framework**: React Router v7 (NOT Remix) for `apps/erp`, `apps/mes`,
  `apps/academy`, `apps/starter`. Flat routes via `remix-flat-routes`.
  `docs` is the exception — Next.js + Fumadocs + MDX.
- **Database**: Supabase/Postgres with RLS; typed access via generated
  `@carbon/database` types + a Kysely client. Never hand-edit generated types.
- **Background jobs**: Inngest (NOT Trigger.dev), via `@carbon/jobs`.
- **Imports**: `~/*` → app code (`./app/*`); `@carbon/*` → workspace packages.
  Server-only auth helpers from `@carbon/auth/auth.server` (`requirePermissions`)
  and `@carbon/auth/session.server` (`flash`).
- **ERP module layout**: `apps/erp/app/modules/{module}/` with `.models.ts`
  (zod validators), `.service.ts` (Supabase/Kysely ops), `index.ts` barrel, `ui/`.
  MES is lighter: services in `apps/mes/app/services/`, components in
  `apps/mes/app/components/`.

## Golden rules

1. **Multi-tenancy**: every table has `companyId` + composite PK `("id", "companyId")`.
2. **IDs**: `id('prefix')` default in SQL, never raw UUID.
3. **Audit**: include `createdBy`, `createdAt`, `updatedBy`, `updatedAt`.
4. **RLS**: standardized policy names `SELECT` / `INSERT` / `UPDATE` / `DELETE`.
5. **Forms**: `ValidatedForm` + zod validator + route action; validate with
   `validator(schema).validate(formData)`, not `schema.parse()`.
6. **Transactions**: Kysely for multi-row writes, not `Promise.all`.
7. **Route actions**: services return `{ data, error }`; on failure
   `return data({}, await flash(request, error(...)))`, on success `throw redirect(...)`.
8. **Migrations**: create with `pnpm db:migrate:new <name>` (the root `db:migrate`
   runs `crbn migrate` to apply). Full DB checklist in conventions-database.md.

## Use existing components

Grep `packages/react/src/` and `apps/erp/app/components/` before writing UI.
Prefer built-in `@carbon/react` / `~/components/Form` variants over ad-hoc
`bg-*` / `text-*` classes.
