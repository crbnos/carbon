# Accounting Sync Handlers

## Overview

The accounting sync system in Carbon uses trigger.dev tasks to synchronize data between accounting providers (like Xero) and the Carbon ERP system. Two main sync tasks exist:
- `from-accounting-sync`: Syncs data FROM accounting provider TO Carbon
- `to-accounting-sync`: Syncs data FROM Carbon TO accounting provider

## Handler Structure

### Handler Architecture

Both sync tasks use a **handler map pattern** where handlers are organized by entity type and operation:

```typescript
// UPSERT_MAP: handles create/update/sync operations
const UPSERT_MAP: Record<keyof EntityMap, SyncFn> = {
  async customer({ client, entity, payload, provider }) { ... },
  async vendor({ client, entity, payload, provider }) { ... },
};

// DELETE_MAP: handles delete operations
const DELETE_MAP: Record<keyof EntityMap, SyncFn> = {
  async customer({ client, entity, payload, provider }) { ... },
  async vendor({ client, entity, payload, provider }) { ... },
};
```

### SyncFn Type Definition

```typescript
type SyncFn = (input: {
  client: SupabaseClient<Database>;        // Supabase client for database queries
  kysely: ReturnType<typeof getPostgresClient>;  // Kysely ORM client
  entity: AccountingEntity;                 // The entity being synced
  provider: AccountingProvider;             // The provider integration instance
  payload: AccountingSyncPayload;           // Full sync payload with metadata
}) => Promise<any> | any;
```

### EntityMap

```typescript
type AccountingEntityType = "customer" | "vendor";

interface EntityMap {
  customer: Accounting.Contact;
  vendor: Accounting.Contact;
}

// Both entity types map to Accounting.Contact schema
namespace Accounting {
  export type Contact = z.infer<typeof ContactSchema>;
}
```

## Entity Types

### Currently Implemented

- **customer**: Maps to accounting provider contacts (with `isCustomer: true`)
- **vendor**: Maps to accounting provider contacts (with `isVendor: true`)

### Commented/Future Support

- bill (Purchase Invoice)
- employee
- invoice
- item
- purchase_order
- sales_order
- inventory_adjustment

## AccountingEntity Structure

```typescript
interface AccountingEntity<T extends AccountingEntityType = AccountingEntityType> {
  entityType: T;           // "customer" | "vendor"
  entityId: string;        // External ID from provider
  operation: "create" | "update" | "delete" | "sync";
  lastSyncedAt?: string;   // Optional timestamp of last sync
}
```

## AccountingSyncPayload

```typescript
interface AccountingSyncPayload {
  companyId: string;
  provider: ProviderID;    // "xero" (QuickBooks commented out)
  syncType: "webhook" | "scheduled" | "trigger";
  syncDirection: "from-accounting" | "to-accounting" | "bi-directional";
  entities: AccountingEntity[];
  metadata?: {
    tenantId?: string;
    webhookId?: string;
    userId?: string;
    [key: string]: any;
  };
}
```

## Handler Invocation Flow

1. **Parse & Validate**: PayloadSchema validates input
2. **Get Integration**: `getAccountingIntegration()` fetches integration metadata
3. **Get Provider**: `getProviderIntegration()` instantiates provider class (XeroProvider)
4. **Iterate Entities**: For each entity in payload:
   - Determine operation type (upsert vs delete)
   - Select handler from UPSERT_MAP or DELETE_MAP based on entityType
   - Execute handler with context
   - Collect results (success/failed)
5. **Return Results**: Returns object with success[] and failed[] arrays

## From-Accounting-Sync Task

**File**: `/Users/sidwebworks/Documents/work/carbon/packages/jobs/trigger/from-accounting-sync.ts`

**Task ID**: `from-accounting-sync`

**Sync Direction**: Only accepts "from-accounting" (not "to-accounting")

### Customer Handler (Implemented)

```typescript
async customer({ client, entity, payload, provider }) {
  try {
    // 1. Check if customer already exists by external ID
    const customer = await getEntityWithExternalId(
      client,
      "customer",
      payload.companyId,
      provider.id,
      { externalId: entity.entityId }
    );

    // 2. Fetch full contact data from provider
    const remote = await provider.contacts.get(entity.entityId);

    // 3. Atomic transaction:
    // - Upsert customer
    const customerId = await upsertCustomerFromAccounting(
      tx,
      remote,
      { companyId: payload.companyId, provider: provider.id },
      customer?.id
    );

    // - Upsert contact and link to customer
    await upsertContactAndLinkToCustomer(tx, remote, customerId, {
      companyId: payload.companyId,
      provider: provider.id,
    });

    return { id: entity.entityId, message: "Created successfully" };
  } catch (error) {
    return { id: entity.entityId, message: `Failed to upsert customer: ${error.message}` };
  }
}
```

### Vendor Handler (Stub)

```typescript
async vendor({ client, entity, payload, provider }) {
  // Empty - not yet implemented
}
```

## To-Accounting-Sync Task

**File**: `/Users/sidwebworks/Documents/work/carbon/packages/jobs/trigger/to-accounting-sync.ts`

**Task ID**: `to-accounting-sync`

**Sync Direction**: Only accepts "to-accounting" (not "from-accounting")

### Customer Handler (Stub with Commented Code)

```typescript
async customer({ client, entity, payload, provider }) {
  const customer = await getEntityWithExternalId(
    client,
    "customer",
    payload.companyId,
    provider.id,
    { id: entity.entityId }
  );

  // Commented out - would call provider.contacts.upsert(data)

  return {
    id: entity.entityId,
    message: "Upserted successfully",
  };
}
```

### Vendor Handler (Stub)

```typescript
async vendor({ client, entity, payload, provider }) {
  // Empty - not yet implemented
}
```

## Key Implementation Patterns

### Pattern 1: External ID Lookup via externalIntegrationMapping
```typescript
// Lookups now use the externalIntegrationMapping table instead of a JSONB column.
const customer = await getEntityWithExternalId(
  client,
  "customer",          // entityType in externalIntegrationMapping
  companyId,
  provider.id,         // integration in externalIntegrationMapping
  { externalId: entity.entityId }  // matches externalIntegrationMapping.externalId
);
```

### Pattern 2: Provider Abstraction
Provider instances (XeroProvider) expose standardized interfaces:
- `provider.contacts.get(id)`: Fetch single contact from provider
- `provider.contacts.upsert(data)`: Upsert contact to provider

### Pattern 3: Atomic Transactions
For from-accounting sync, customer creation uses Kysely transactions:
```typescript
await kysely.transaction().execute(async (tx) => {
  const customerId = await upsertCustomerFromAccounting(tx, ...);
  await upsertContactAndLinkToCustomer(tx, ...);
});
```

### Pattern 4: Error Handling in Loops
Handlers can return error objects instead of throwing:
```typescript
{
  id: entity.entityId,
  message: `Failed to upsert customer: ${error.message}`
}
```

Results accumulate in success[] and failed[] arrays.

## External ID Storage (externalIntegrationMapping table)

External IDs are now stored in a dedicated `externalIntegrationMapping` table instead of JSONB columns on each entity table. The old `externalId` JSONB columns have been dropped from all entity tables.

### Table Schema

```sql
CREATE TABLE "externalIntegrationMapping" (
  "id" TEXT NOT NULL DEFAULT id(),
  "entityType" TEXT NOT NULL,           -- 'customer', 'supplier', 'item', 'contact', etc.
  "entityId" TEXT NOT NULL,             -- The internal Carbon ID
  "integration" TEXT NOT NULL,          -- 'xero', 'linear', 'quickbooks', etc.
  "externalId" TEXT,                    -- The ID in the external system (nullable)
  "allowDuplicateExternalId" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,                     -- Provider-specific extras
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "remoteUpdatedAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT,
  "companyId" TEXT NOT NULL,

  -- One mapping per integration per entity (always enforced)
  CONSTRAINT ... UNIQUE ("entityType", "entityId", "integration", "companyId")
);
```

### Key Constraints

- **One-to-one by default**: A unique constraint on `(entityType, entityId, integration, companyId)` ensures one mapping per integration per entity.
- **External ID uniqueness**: A partial unique index on `(integration, externalId, entityType, companyId)` enforces uniqueness when `allowDuplicateExternalId = false`.
- **Many-to-one support**: When `allowDuplicateExternalId = true`, multiple Carbon entities can map to the same external ID.

### Query Patterns

```sql
-- Find Carbon entity by external ID
SELECT "entityId" FROM "externalIntegrationMapping"
WHERE "integration" = 'xero'
  AND "externalId" = 'remote-contact-id'
  AND "entityType" = 'customer'
  AND "companyId" = '...';

-- Find external ID for a Carbon entity
SELECT "externalId", "metadata" FROM "externalIntegrationMapping"
WHERE "entityType" = 'customer'
  AND "entityId" = '...'
  AND "integration" = 'xero';
```

### Backward-Compatible Views

Database views (e.g. `suppliers`, `customers`, `parts`, `materials`, `tools`, `consumables`, `services`, `salesOrders`) reconstruct the old JSONB format using a subquery:

```sql
(
  SELECT COALESCE(
    jsonb_object_agg(
      eim."integration",
      CASE
        WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
        ELSE to_jsonb(eim."externalId")
      END
    ) FILTER (WHERE eim."externalId" IS NOT NULL),
    '{}'::jsonb
  )
  FROM "externalIntegrationMapping" eim
  WHERE eim."entityType" = 'customer' AND eim."entityId" = c.id
) AS "externalId"
```

This allows existing application code reading from views to continue working without changes.

## Related Services & Utilities

### From-Accounting Specific:
- `upsertCustomerFromAccounting()`: Creates or updates customer from provider contact
- `upsertContactAndLinkToCustomer()`: Creates contact and links to customer with conflict resolution

### Shared:
- `getAccountingIntegration()`: Fetches integration config by provider ID
- `getProviderIntegration()`: Instantiates provider class (XeroProvider)
- `getEntityWithExternalId()`: Queries entity via `externalIntegrationMapping` table by provider's external ID

## Task Configuration

Both tasks use Trigger.dev v4 SDK:

```typescript
task({
  id: "from-accounting-sync" | "to-accounting-sync",
  retry: { maxAttempts: 2, randomize: true },
  run: async (input: Payload) => { ... }
})
```

## Status of Implementation

- **from-accounting-sync customer**: FULLY IMPLEMENTED
- **to-accounting-sync customer**: STUBBED (commented logic for upsert)
- **Both vendor handlers**: NOT IMPLEMENTED (empty)

## Next Steps for Vendor Support

To implement vendor handlers:

1. Create handler functions in both UPSERT_MAP and DELETE_MAP
2. Use similar patterns as customer handlers
3. Determine if vendors map to accounting provider contacts or separate entity
4. Create externalIntegrationMapping entries for vendor entity mappings
5. Handle bi-directional sync if needed
