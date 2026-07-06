# Services Conventions

Service functions live in `app/modules/{module}/{module}.service.ts` and handle database operations.

## File Structure

```
app/modules/{module}/
├── {module}.models.ts    # Zod validators, types
├── {module}.service.ts   # Database operations
├── index.ts              # Re-exports
└── ui/                   # Components
```

## Service Function Pattern

```typescript
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getThing(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("thing")
    .select("*")
    .eq("id", id)
    .single();
}

export async function insertThing(
  client: SupabaseClient<Database>,
  data: {
    name: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("thing")
    .insert(data)
    .select("id")
    .single();
}

export async function updateThing(
  client: SupabaseClient<Database>,
  id: string,
  data: {
    name?: string;
    updatedBy: string;
  }
) {
  return client
    .from("thing")
    .update(data)
    .eq("id", id)
    .select("id")
    .single();
}

export async function deleteThing(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("thing")
    .delete()
    .eq("id", id);
}
```

## Return Pattern

All Supabase operations return `{ data, error }`. The route handler checks:

```typescript
const result = await insertThing(client, data);

if (result.error) {
  return data({}, await flash(request, error(result.error, "Failed")));
}

// Use result.data
```

## Upsert Pattern

For create/update in one function:

```typescript
export async function upsertThing(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    name: string;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("thing")
      .update({
        name: data.name,
        updatedBy: data.updatedBy,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }
  
  return client
    .from("thing")
    .insert({
      name: data.name,
      companyId: data.companyId,
      createdBy: data.createdBy,
    })
    .select("id")
    .single();
}
```

## Transaction Pattern

For multi-row writes, use Kysely (see [database.md](database.md#transactions-kysely)):

```typescript
import type { Kysely, KyselyDatabase } from "@carbon/database/client";

export async function updateThingOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("thing")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}
```

## List with Filters

```typescript
export async function getThings(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    search?: string;
    active?: boolean;
    limit?: number;
    offset?: number;
  }
) {
  let query = client
    .from("thing")
    .select("*", { count: "exact" })
    .eq("companyId", args.companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args.active !== undefined) {
    query = query.eq("active", args.active);
  }

  if (args.limit) {
    query = query.limit(args.limit);
  }

  if (args.offset) {
    query = query.range(args.offset, args.offset + (args.limit ?? 10) - 1);
  }

  return query.order("name");
}
```

## Sequence Numbers

For documents that need sequential numbers:

```typescript
import { getNextSequence } from "~/modules/settings";

export async function insertOrder(
  client: SupabaseClient<Database>,
  data: { ... }
) {
  const orderNumber = await getNextSequence(client, data.companyId, "salesOrder");
  
  return client
    .from("salesOrder")
    .insert({
      ...data,
      orderNumber,
    })
    .select("id")
    .single();
}
```

## Error Handling

Services return `{ data, error }` — they don't throw. Route handlers convert to flash messages:

```typescript
// In route action
const result = await insertThing(client, data);

if (result.error) {
  // Supabase error object has message
  return data({}, await flash(request, error(result.error, "Failed to create thing")));
}
```

## Naming Conventions

| Operation | Name |
|-----------|------|
| Get one | `getThing(client, id)` |
| Get list | `getThings(client, args)` |
| Insert | `insertThing(client, data)` |
| Update | `updateThing(client, id, data)` |
| Upsert | `upsertThing(client, data)` |
| Delete | `deleteThing(client, id)` |
| Bulk order | `updateThingOrder(db, updates)` |

## Checklist

- [ ] First arg is `client: SupabaseClient<Database>` (or `db: Kysely<...>` for transactions)
- [ ] Returns `{ data, error }` pattern
- [ ] Uses `.select()` after insert/update to return created/updated row
- [ ] Uses `.single()` when expecting one row
- [ ] Exported from module index
- [ ] Multi-row writes use Kysely transactions
