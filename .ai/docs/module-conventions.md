# Carbon Module Conventions

How ERP feature modules are structured. Follow these conventions when creating or modifying modules.

## ERP Module Layout

Every ERP module lives under `apps/erp/app/modules/{module}/`:

```
modules/{module}/
├── {module}.models.ts    # zod validators + derived types
├── {module}.service.ts   # Supabase/Kysely data operations
├── {module}.server.ts    # server-only helpers (optional)
├── types.ts              # shared types (optional)
├── index.ts              # barrel: re-exports models/service/types
└── ui/                   # feature components (PascalCase filenames)
```

### Naming Rules

- **Folder names**: kebab-case (`storage-rules`, not `storageRules`)
- **Module files**: match folder name (`purchasing.service.ts`, `purchasing.models.ts`)
- **React components**: PascalCase filenames in `ui/` (`PurchaseOrderForm.tsx`)
- **Barrel exports**: `index.ts` re-exports everything; import from module root (`~/modules/sales`), not deep files

### Required Files

| File | Purpose | Always Required? |
|------|---------|-----------------|
| `{module}.models.ts` | Zod validators + derived TypeScript types | Yes |
| `{module}.service.ts` | Data operations (Supabase client as first arg) | Yes |
| `index.ts` | Barrel re-export | Yes |
| `{module}.server.ts` | Server-only helpers | When needed |
| `types.ts` | Shared type definitions | When needed |
| `ui/` | React components | When there's UI |

### MES Module Layout

MES is lighter — flat structure:
- Services: `apps/mes/app/services/{name}.service.ts`
- Components: `apps/mes/app/components/`

## Service Functions

Every service function:
1. Takes **client as its first argument** (`SupabaseClient<Database>`)
2. Returns the raw `{ data, error }` from Supabase — does NOT throw, does NOT unwrap
3. Includes `companyId` scoping on every query

```typescript
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getItems(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { search?: string; limit?: number }
) {
  return client
    .from("item")
    .select("*")
    .eq("companyId", companyId)
    .ilike("name", `%${args.search ?? ""}%`)
    .limit(args.limit ?? 50);
}
```

## Models (Zod Validators)

```typescript
import { z } from "zod";

export const itemValidator = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  active: z.boolean().default(true),
});

export type Item = z.infer<typeof itemValidator>;
```

## Route Patterns

Routes live under `apps/erp/app/routes/` using `remix-flat-routes` conventions.

### Loader Pattern

```typescript
import type { LoaderFunctionArgs } from "react-router";
import { requirePermissions } from "@carbon/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const items = await getItems(client, companyId, {});
  return { items: items.data ?? [] };
}
```

### Action Pattern

```typescript
import type { ActionFunctionArgs } from "react-router";
import { redirect, data } from "react-router";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { validator } from "@carbon/form";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const validation = await validator(itemValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      { errors: validation.error },
      await flash(request, error(validation.error, "Validation failed"))
    );
  }

  const result = await createItem(client, companyId, userId, validation.data);
  if (result.error) {
    return data({}, await flash(request, error(result.error, "Failed to create")));
  }

  throw redirect(`/x/items/${result.data.id}`);
}
```

**Key rules:**
- On success: `throw redirect(...)` (NOT `return redirect(...)`)
- On failure: `return data({}, await flash(request, error(...)))`
- Always call `assertIsPost(request)` first
- Always validate with `validator(schema).validate(formData)`, not `schema.parse()`

## Database Tables

Every table follows the template in `.claude/rules/conventions-database.md`:

```sql
CREATE TABLE "entityName" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    -- Business columns
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "entityName_companyId_idx" ON "entityName" ("companyId");
CREATE INDEX "entityName_createdBy_idx" ON "entityName" ("createdBy");

ALTER TABLE "public"."entityName" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."entityName"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."entityName"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('module_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."entityName"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('module_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."entityName"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('module_delete'))::text[])
);
```

**RLS conventions (from the rls-refactor):**
- Policy names are exactly `SELECT`, `INSERT`, `UPDATE`, `DELETE` — not verbose descriptions
- **SELECT** → `get_companies_with_employee_role()` (any employee can read)
- **INSERT / UPDATE / DELETE** → `get_companies_with_employee_permission('<module>_<action>')`
- The old `has_role()` / `has_company_permission()` helpers are **deprecated** — never use them
- Wrap helper calls in `(SELECT ...)` for per-statement evaluation (Postgres InitPlan optimization)
- Cast result `::text[]`

## Forms

Use `ValidatedForm` from `@carbon/form` with a zod validator:

```tsx
import { ValidatedForm } from "@carbon/form";
import { validator } from "@carbon/form";
import { Input, VStack, Button } from "@carbon/react";

function ItemForm({ initialValues }: { initialValues?: Item }) {
  return (
    <ValidatedForm
      validator={validator(itemValidator)}
      defaultValues={initialValues}
      method="post"
    >
      <VStack spacing={4}>
        <Input name="name" label="Name" />
        <Input name="description" label="Description" />
        <Button type="submit">Save</Button>
      </VStack>
    </ValidatedForm>
  );
}
```

## Cross-References

- Database conventions: `.claude/rules/conventions-database.md`
- Service conventions: `.claude/rules/conventions-services.md`
- Form conventions: `.claude/rules/conventions-forms.md`
- UI conventions: `.claude/rules/conventions-ui.md`
- Coding conventions: `.claude/rules/coding-conventions.md`
