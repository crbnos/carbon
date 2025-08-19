# Supabase Pagination Utilities

## Overview

Supabase has a default limit of 1000 rows per request. To handle queries that might return more than 1000 rows, we've implemented pagination utilities that automatically handle batching and fetching all records.

## Utilities

### `fetchAllRecords<T>(baseQuery)`

Fetches all records from a Supabase query by automatically handling pagination.

```typescript
import { fetchAllRecords } from "~/utils/supabase-pagination";

const query = client.from("items").select("*").eq("companyId", companyId);

const result = await fetchAllRecords(query);
// result.data contains ALL items, not just first 1000
```

### `fetchAllFromTable<T>(client, tableName, selectColumns, filterFn)`

Helper function for simple table queries that need all records.

```typescript
import { fetchAllFromTable } from "@carbon/database";

const result = await fetchAllFromTable(
  client,
  "items",
  "id, name, type",
  (query) => query.eq("companyId", companyId).eq("active", true).order("name")
);
```

### `fetchRecordsInBatches<T>(baseQuery, batchSize)`

Async generator for processing large datasets in batches.

```typescript
import { fetchRecordsInBatches } from "~/utils/supabase-pagination";

const query = client.from("items").select("*").eq("companyId", companyId);

for await (const { data, batch, hasMore } of fetchRecordsInBatches(
  query,
  500
)) {
  console.log(`Processing batch ${batch} with ${data.length} items`);
  // Process each batch of 500 items
  await processItems(data);
}
```

## When to Use

### ✅ Use pagination utilities for:

- **RealtimeDataProvider queries** - Fetching all items, customers, suppliers, etc. for local storage
- **List functions** - `getPartsList()`, `getMaterialsList()`, etc. used in dropdowns
- **Export functions** - When exporting all records to CSV/Excel
- **Bulk operations** - Processing all records of a certain type
- **Any query that could potentially return >1000 rows**

### ❌ Don't use for:

- **UI pagination** - Use existing `setGenericQueryFilters()` with limit/offset
- **Single record lookups** - `.single()` queries
- **Small datasets** - Tables that will never exceed 1000 rows
- **Performance critical paths** - When you specifically need only the first N records

## Migration Examples

### Before (❌ Could hit 1000 row limit)

```typescript
export async function getItemsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("item")
    .select("id, name, type")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}
```

### After (✅ Handles unlimited rows)

```typescript
import { fetchAllFromTable } from "@carbon/database";

export async function getItemsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable(client, "item", "id, name, type", (query) =>
    query.eq("companyId", companyId).eq("active", true).order("name")
  );
}
```

## Return Type

All pagination utilities return a `PaginatedResult<T>`:

```typescript
interface PaginatedResult<T> {
  data: T[]; // All fetched records
  count: number | null; // Total count (from first request)
  error: any; // Error if query failed
}
```

## Performance Considerations

- **Batch size**: Default is 1000 (Supabase's limit). Can be customized for memory optimization
- **Memory usage**: All records are loaded into memory. Use `fetchRecordsInBatches` for very large datasets
- **Network requests**: Makes multiple requests automatically. Progress can be tracked with the generator approach
- **Caching**: Results are not cached. Consider implementing caching at the application level for frequently accessed data

## Example: Complex Query with Pagination

```typescript
import { fetchAllRecords } from "~/utils/supabase-pagination";

export async function getAllActiveItemsWithSuppliers(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const query = client
    .from("items")
    .select(
      `
      id,
      name,
      type,
      supplier:supplierId (
        id,
        name
      )
    `
    )
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");

  const result = await fetchAllRecords(query);

  if (result.error) {
    throw new Error(`Failed to fetch items: ${result.error.message}`);
  }

  return result.data;
}
```

## Testing

When testing functions that use pagination utilities, the utilities will work normally but you can mock them if needed:

```typescript
import { fetchAllFromTable } from "@carbon/database";

// Mock for testing
jest.mock("~/utils/supabase-pagination", () => ({
  fetchAllFromTable: jest.fn(),
}));

// In test
(fetchAllFromTable as jest.Mock).mockResolvedValue({
  data: mockItems,
  count: mockItems.length,
  error: null,
});
```
