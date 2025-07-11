# Carbon Database Patterns

## Database Technology

Carbon uses Supabase (PostgreSQL) as its database with:

- Type-safe queries using generated TypeScript types
- Row-level security (RLS) for authorization
- Real-time subscriptions for live updates

## Client Creation Patterns

### Standard Client

```typescript
import { getCarbon, requirePermissions } from "@carbon/auth";

// From request in loader or action
const { client } = requirePermissions(request, {
  view: "module",
});
```

### Service Role Client

```typescript
import { getCarbonServiceRole } from "@carbon/auth";

// Only available server-side
const client = getCarbonServiceRole();
```

### API Key Client

```typescript
import { getCarbonAPIKeyClient } from "@carbon/auth";

const client = getCarbonAPIKeyClient(apiKey);
```

## Query Patterns

### Basic Query

```typescript
const { data, error } = await client
  .from("customer")
  .select("*")
  .eq("companyId", companyId)
  .single();
```

### Complex Queries with Joins

```typescript
const { data } = await client
  .from("salesOrder")
  .select(
    `
    *,
    customer (
      id,
      name,
      email
    ),
    salesOrderLine (
      *,
      item (
        id,
        name
      )
    )
  `
  )
  .eq("id", orderId);
```

## Service Function Patterns

Services typically follow this pattern:

```typescript
export async function updateCustomer(
  client: SupabaseClient<Database>,
  customerId: string,
  updates: Partial<Customer>
) {
  const { data, error } = await client
    .from("customer")
    .update(updates)
    .eq("id", customerId)
    .select()
    .single();

  if (error) {
    throw new Error("Failed to update customer");
  }

  return data;
}
```

## Type Safety

The project uses generated types from the database schema:

```typescript
import type { Database } from "@carbon/database";

type Customer = Database["public"]["Tables"]["customer"]["Row"];
type CustomerInsert = Database["public"]["Tables"]["customer"]["Insert"];
type CustomerUpdate = Database["public"]["Tables"]["customer"]["Update"];
```

## Transaction Patterns

For complex operations requiring multiple queries:

```typescript
// Using RPC functions for transactions
const { data, error } = await client.rpc("create_sales_order", {
  customer_id: customerId,
  lines: orderLines,
});
```

## Real-time Subscriptions

```typescript
const subscription = client
  .channel("sales_orders")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "salesOrder",
    },
    (payload) => {
      // Handle real-time updates
    }
  )
  .subscribe();
```

## Error Handling

```typescript
try {
  const { data, error } = await client.from("table").select().single();

  if (error) {
    console.error("Database error:", error);
    throw new Error("Failed to fetch data");
  }

  return data;
} catch (err) {
  // Handle error appropriately
  throw err;
}
```

## Migration Management

- Migrations are stored in `/packages/database/supabase/migrations/`
- Named with timestamps and descriptive names
- Applied automatically via Supabase CLI

## Common Tables

Based on the codebase, common tables include:

- `customer` - Customer information
- `supplier` - Supplier information
- `item` - Products/parts/materials
- `salesOrder` - Sales orders
- `purchaseOrder` - Purchase orders
- `employee` - Employee records
- `company` - Company/tenant information
