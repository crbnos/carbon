# Database Conventions

## Migrations

Location: `packages/database/supabase/migrations/`

### Generate Migration

```bash
npm run db:migrate <name-of-migration>
```

**WARNING:** Never use `000000` as HHMMSS in filename. Use random digits to avoid cross-branch collisions.

### Table Template

```sql
CREATE TABLE "entityName" (
    "id" TEXT NOT NULL DEFAULT id('entity'),
    "companyId" TEXT NOT NULL,
    
    -- Business columns
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Audit columns (required)
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    
    -- Optional extensibility
    "customFields" JSONB,
    "tags" TEXT[],
    
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

-- Required indexes
CREATE INDEX "entityName_companyId_idx" ON "entityName" ("companyId");
CREATE INDEX "entityName_createdBy_idx" ON "entityName" ("createdBy");
```

### Required Patterns

| Pattern | Rule |
|---------|------|
| Primary key | `id TEXT NOT NULL DEFAULT id('prefix')` |
| Multi-tenancy | `companyId TEXT NOT NULL` + composite PK |
| Audit columns | `createdBy`, `createdAt`, `updatedBy`, `updatedAt` |
| Foreign keys | Always index them |
| Never | `itemReadableId` field, decimal precision in NUMERIC |

### Column Types

| Type | Use For |
|------|---------|
| `TEXT` | IDs, names, strings |
| `NUMERIC` | Financial amounts |
| `INTEGER` | Quantities |
| `TIMESTAMP WITH TIME ZONE` | Dates/times |
| `BOOLEAN NOT NULL DEFAULT` | Flags |
| `JSONB` | Custom fields |
| `TEXT[]` | Tags |

### RLS Policies

Use standardized names and pattern:

```sql
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

### Views

```sql
CREATE VIEW "module_entityView" WITH(SECURITY_INVOKER=true) AS
SELECT e.*, u."fullName" as "createdByFullName"
FROM "entityName" e
LEFT JOIN "user" u ON u."id" = e."createdBy";
```

### Test Migration

```bash
npm run db:build
```

## Transactions (Kysely)

Use Kysely transactions for multi-row writes. Supabase `Promise.all` can leave data half-applied.

### When to Use

- Bulk reorder / sortOrder updates
- Multi-table writes (parent + children)
- Any operation where partial failure is a bug

### When NOT to Use

- Single writes (already atomic)
- Reads (use Supabase client for RLS)
- Idempotent fan-out where retry is cheap

### Pattern

```typescript
// Service function
import type { Kysely, KyselyDatabase } from "@carbon/database/client";

export async function updateLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("tableName")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

// Route handler
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request }: ActionFunctionArgs) {
  const { userId } = await requirePermissions(request, { update: "module" });
  try {
    await updateLineOrder(getDatabaseClient(), updates);
  } catch (err) {
    return data({}, await flash(request, error(err, "Failed to update")));
  }
  return { success: true };
}
```

### Key Notes

- First arg is `db: Kysely<KyselyDatabase>`, route passes `getDatabaseClient()`
- Kysely throws on rollback — use try/catch, not `{ error }` return
- Kysely bypasses RLS — enforce auth at route via `requirePermissions()`

## Zod Validators

After migration, update `.models.ts`:

```typescript
import { z } from "zod";
import { zfd } from "zod-form-data";

export const entityValidator = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  active: z.boolean().default(true),
});

export const entityFormValidator = zfd.formData({
  name: zfd.text(z.string().min(1)),
  description: zfd.text(z.string().optional()),
  active: zfd.checkbox(),
});
```

## Migration Checklist

- [ ] File created with `npm run db:migrate <name>`
- [ ] Uses `id('prefix')` for primary key
- [ ] Has `companyId` with composite PK
- [ ] Has audit columns
- [ ] Indexes on companyId and foreign keys
- [ ] RLS with standardized policy names
- [ ] Zod validators in `.models.ts`
- [ ] Tested with `npm run db:build`
