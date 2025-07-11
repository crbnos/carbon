# Database Migration Workflow

This workflow describes the process for creating and applying database migrations in the Carbon manufacturing system.

## Prerequisites

- Ensure you have the latest code from the main branch
- Check that your local database is running and accessible
- Verify you have the necessary permissions to modify the database schema
- Understand the multi-tenant architecture (all tables require companyId)

## Steps

### 1. Generate Migration File

Run the migration command:

```bash
npm run db:migrate <name-of-migration>
```

This will create a new migration file in `packages/database/supabase/migrations/` with the timestamp prefix.

### 2. Analyze the Migration Requirements

- Identify what database changes are needed (new tables, columns, indexes, etc.)
- Check existing schema to avoid conflicts
- Consider data migration needs if modifying existing tables
- Determine which module this belongs to (for updating .models.ts files)

### 3. Write Migration SQL

#### Carbon-Specific Patterns

All tables in Carbon follow these patterns:

##### ID Generation

```sql
-- Always use xid() for primary keys
"id" TEXT NOT NULL DEFAULT xid()
```

##### Multi-Tenancy

```sql
-- Every business table needs companyId
"companyId" TEXT NOT NULL,

-- Composite primary key
PRIMARY KEY ("id", "companyId"),

-- Foreign key to company table
FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE

-- Always index companyId
CREATE INDEX "tableName_companyId_idx" ON "tableName" ("companyId");
```

##### Standard Audit Columns

```sql
"createdBy" TEXT NOT NULL REFERENCES "user"("id"),
"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
"updatedBy" TEXT REFERENCES "user"("id"),
"updatedAt" TIMESTAMP WITH TIME ZONE
```

#### Complete Table Example

```sql
CREATE TABLE "entityyName" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,

    -- Standard audit columns
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    -- Optional: Custom fields for extensibility
    "customFields" JSONB,
    "tags" TEXT[],

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

-- Required indexes
CREATE INDEX "entityName_companyId_idx" ON "entityName" ("companyId");
CREATE INDEX "entityName_createdBy_idx" ON "entityName" ("createdBy");

-- Optional: Unique constraint scoped to company
ALTER TABLE "entityName" ADD CONSTRAINT "entityName_name_companyId_key"
    UNIQUE ("name", "companyId");
```

#### Row Level Security (RLS)

**IMPORTANT**: Use the new standardized RLS pattern (2025+):

```sql
-- Enable RLS
ALTER TABLE "entityName" ENABLE ROW LEVEL SECURITY;

-- Standardized policy names: SELECT, INSERT, UPDATE, DELETE
CREATE POLICY "SELECT" ON "entityName"
  FOR SELECT
  TO authenticated
  USING (
    "companyId" IN (
      SELECT "companyId"
      FROM get_companies_with_employee_permission(auth.uid(), 'module:view')
    )
  );

CREATE POLICY "INSERT" ON "entityName"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "companyId" IN (
      SELECT "companyId"
      FROM get_companies_with_employee_permission(auth.uid(), 'module:create')
    )
  );

CREATE POLICY "UPDATE" ON "entityName"
  FOR UPDATE
  TO authenticated
  USING (
    "companyId" IN (
      SELECT "companyId"
      FROM get_companies_with_employee_permission(auth.uid(), 'module:update')
    )
  );

CREATE POLICY "DELETE" ON "entityName"
  FOR DELETE
  TO authenticated
  USING (
    "companyId" IN (
      SELECT "companyId"
      FROM get_companies_with_employee_permission(auth.uid(), 'module:delete')
    )
  );
```

#### Common Column Types

- **IDs**: `TEXT NOT NULL DEFAULT xid()`
- **Names**: `TEXT NOT NULL`
- **Financial**: `NUMERIC` or `DECIMAL`
- **Quantities**: `INTEGER`
- **Timestamps**: `TIMESTAMP WITH TIME ZONE`
- **Booleans**: `BOOLEAN NOT NULL DEFAULT TRUE/FALSE`
- **JSON**: `JSONB` for custom fields

#### Creating Views

```sql
CREATE VIEW "module_entityView" WITH(SECURITY_INVOKER=true) AS
SELECT
    e.*,
    u."fullName" as "createdByFullName"
FROM "entityName" e
LEFT JOIN "user" u ON u."id" = e."createdBy";
```

### 4. Update Zod Validators

After creating the migration, update the appropriate `.models.ts` file in the ERP app:

```typescript
// apps/carbon/app/modules/[module-name]/[module-name].models.ts

import { z } from "zod";
import { zfd } from "zod-form-data";

// Base validator matching the database schema
export const entityValidator = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  active: z.boolean().default(true),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedBy: z.string().optional(),
  updatedAt: z.date().optional(),
  customFields: z.any().optional(),
});

// Form validator for create/update operations
export const entityFormValidator = zfd.formData({
  name: zfd.text(z.string().min(1)),
  description: zfd.text(z.string().optional()),
  active: zfd.checkbox(),
  // Don't include audit fields in forms
});
```

### 5. Test Migration Locally

- Test the migration by running `npm run db:build`

## Best Practices

- Always use `xid()` for primary keys
- Include `companyId` in all business tables
- Use composite primary keys `("id", "companyId")`
- Follow the standardized RLS policy naming (SELECT, INSERT, UPDATE, DELETE)
- Add appropriate indexes for all foreign keys
- Use `NUMERIC` for financial amounts
- Include audit columns (createdBy, createdAt, updatedBy, updatedAt)
- Consider adding `customFields JSONB` for extensibility
- Add `tags TEXT[]` if it is a main document type
- Use transactions for multi-table operations
- Test migrations with existing data before deployment

## Common Pitfalls to Avoid

- Forgetting to add `companyId` to new tables
- Not including companyId in the composite primary key
- Using old RLS pattern instead of standardized names
- Forgetting to index foreign keys and companyId
- Not updating the corresponding .models.ts file
- Making nullable columns that should be required
- Not considering multi-tenant data isolation

## Migration Checklist

- [ ] Migration file created with `npm run db:migrate <name>`
- [ ] Table includes `id` with `DEFAULT xid()`
- [ ] Table includes `companyId` with proper foreign key
- [ ] Composite primary key on `("id", "companyId")`
- [ ] Standard audit columns included
- [ ] All necessary indexes created (especially on companyId)
- [ ] RLS policies created with standardized names
- [ ] Zod validators created/updated in .models.ts file
- [ ] Tests written for new functionality
- [ ] Multi-tenant isolation verified
- [ ] Migration tested on local database
- [ ] Team notified of pending database changes
