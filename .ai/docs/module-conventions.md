# Carbon Module Conventions

How ERP feature modules are structured. Follow these conventions when creating or modifying modules.

## ERP Module Layout

Every ERP module lives under `apps/erp/app/modules/{module}/`:

```
modules/{module}/
├── {module}.server.ts    # defineServiceFn operations: the module's API
├── {module}.service.ts   # building blocks the operations call (server-only)
├── {module}.models.ts    # zod validators + derived types
├── {module}.utils.ts     # browser-safe helpers (optional)
├── types.ts              # shared types (optional)
└── ui/                   # feature components (PascalCase filenames)
```

### Naming Rules

- **Folder names**: kebab-case (`storage-rules`, not `storageRules`)
- **Module files**: match folder name (`purchasing.server.ts`, `purchasing.models.ts`)
- **React components**: PascalCase filenames in `ui/` (`PurchaseOrderForm.tsx`)
- **No barrel**: there is no `index.ts`. Import from the file that defines the thing (`~/modules/sales/sales.models`)
- **Operation names**: the const's name is the public name — `setQuoteStatus` in `sales.server.ts` is `api.sales.setQuoteStatus`, the MCP tool `sales_setQuoteStatus` and `POST /api/v1/sales/setQuoteStatus`
- **License header**: every new file starts with its SPDX header — AGPL, or commercial for `.ee.` files (e.g. `ui/ApprovalRuleForm.ee.tsx`). Run `pnpm --filter @carbon/checks license-headers` rather than typing it.

### Required Files

| File | Purpose | Always Required? |
|------|---------|-----------------|
| `{module}.server.ts` | `defineServiceFn` consts only | Yes |
| `{module}.service.ts` | Queries, writes and helpers the operations call | Yes |
| `{module}.models.ts` | Zod validators + derived TypeScript types | Yes |
| `{module}.utils.ts` | Pure helpers a component calls | When needed |
| `types.ts` | Shared type definitions | When needed |
| `ui/` | React components | When there's UI |

Full rules and the checks that enforce them: `.claude/rules/module-files.md`.

### MES Module Layout

MES is lighter — flat structure:
- Services: `apps/mes/app/services/{name}.service.ts`
- Components: `apps/mes/app/components/`

## Service Functions

An operation is a `defineServiceFn` const in `{module}.server.ts`
(`.claude/rules/conventions-services.md`). It names its input schema and
permission, and its `run` calls the building blocks in `{module}.service.ts`.
A building block:
1. Takes **client as its first argument** (`SupabaseClient<Database>`, or `db: Kysely<KyselyDatabase>`)
2. Returns the raw `{ data, error }` from Supabase — does NOT throw, does NOT unwrap
3. Includes `companyId` scoping on every query

```typescript
// items.service.ts
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

// items.server.ts
import * as service from "./items.service";

/**
 * List items.
 *
 * @mcp
 */
export const getItems = defineServiceFn({
  input: z.object({ search: z.string().optional() }),
  permission: { view: "parts" },
  async run(ctx, input) {
    return unwrap(ctx, await service.getItems(ctx.asCaller.supabase, ctx.company.id, input));
  }
});
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
import { carbon } from "@carbon/api/carbon.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const api = await carbon(request);
  const items = await api.items.getItems({});
  return { items: items.data ?? [] };
}
```

### Action Pattern

```typescript
import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(itemValidator).request(args, { params: ["itemId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.items.updateItem({ ...input.data, id: input.params.itemId });
  return respond(args.request, result).redirect(path.to.item(input.params.itemId), {
    message: "Updated item"
  });
}
```

**Key rules:**
- `validator(schema).request(args, { params })` checks the method (POST by default), the route params and the form, before any auth
- One call through `carbon(request)`; the operation runs the permission gate
- A fetcher form returns the result (the component's `useAction` toasts it); a navigating form uses `respond(request, result).redirect(to, { message, onError })`

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
