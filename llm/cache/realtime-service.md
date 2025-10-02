# Realtime Service in Carbon

## Overview

Carbon uses Supabase Realtime to provide live database updates across the application. The realtime service enables real-time synchronization of data changes between the database and the UI without polling.

## Architecture

### Core Components

1. **Supabase Realtime Client** - Built into the Supabase client (`carbon.realtime`)
2. **RealtimeDataProvider** - Context provider for core data stores (items, customers, suppliers, people)
3. **useRealtime Hook** - Reusable hook for table-specific realtime subscriptions

## Authentication Setup

### Setting Authentication Token

Before subscribing to realtime channels, you must authenticate the realtime connection:

```typescript
import { useCarbon } from "@carbon/auth";

const { carbon, accessToken } = useCarbon();

// Set the authentication token for realtime
carbon.realtime.setAuth(accessToken);
```

**Important**:

- `carbon.realtime.setAuth(accessToken)` must be called before subscribing to channels
- The access token is obtained from the `useCarbon()` hook
- The token should be updated whenever it changes (on refresh)

## Subscription Patterns

### Basic Subscription with useRealtime Hook

Located at: `/apps/erp/app/hooks/useRealtime.tsx` and `/apps/mes/app/hooks/useRealtime.tsx`

```typescript
import { useRealtime } from "~/hooks/useRealtime";

// Subscribe to a table
useRealtime("salesOrder");

// Subscribe with a filter
useRealtime("salesOrder", `status=eq.released`);
```

**How it works:**

1. Sets authentication using `carbon.realtime.setAuth(accessToken)`
2. Creates a channel with unique name: `postgres_changes:${table}`
3. Listens for all database events (`*`) on the specified table
4. Filters by companyId to ensure multi-tenant isolation
5. Calls `revalidator.revalidate()` to trigger Remix loader refetch
6. Automatically cleans up subscription on unmount

### Advanced Subscription with RealtimeDataProvider

Located at: `/apps/erp/app/components/RealtimeDataProvider.tsx` and `/apps/mes/app/components/RealtimeDataProvider.tsx`

This provider manages realtime subscriptions for core lookup data (items, customers, suppliers, employees) and maintains them in Zustand stores with IndexedDB persistence.

**Features:**

- Hydrates data from IndexedDB first for instant UI
- Fetches fresh data from server on mount
- Subscribes to realtime changes for all core tables
- Updates Zustand stores in real-time
- Persists changes to IndexedDB
- Handles INSERT, UPDATE, and DELETE events

**Example Implementation:**

```typescript
import { useCarbon } from "@carbon/auth";
import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

const RealtimeDataProvider = ({ children }) => {
  const { carbon, accessToken } = useCarbon();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!carbon || !accessToken) return;

    // Authenticate realtime connection
    carbon.realtime.setAuth(accessToken);

    // Create channel with multiple table subscriptions
    channelRef.current = carbon
      .channel("realtime:core")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "item",
        },
        (payload) => {
          // Handle item changes
          switch (payload.eventType) {
            case "INSERT":
              // Add new item to store
              break;
            case "UPDATE":
              // Update item in store
              break;
            case "DELETE":
              // Remove item from store
              break;
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customer",
        },
        (payload) => {
          // Handle customer changes
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [carbon, accessToken]);

  // Update auth when token changes
  useEffect(() => {
    if (carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
    }
  }, [accessToken]);

  return <>{children}</>;
};
```

## Database Schema Requirements

For realtime to work, you need:

1. **Row Level Security (RLS)** enabled on tables
2. **Replica Identity** set to FULL for tables you want to track DELETEs
3. **Publications** configured in Supabase (usually handled automatically)

## Common Use Cases

### 1. Page-Level Revalidation

Use `useRealtime` hook to revalidate the entire page when data changes:

```typescript
// In a route component
import { useRealtime } from "~/hooks/useRealtime";

export default function JobsPage() {
  useRealtime("job");

  // Component renders with loader data
  // Automatically revalidates when job table changes
}
```

### 2. Store-Level Updates

Use RealtimeDataProvider pattern for frequently accessed lookup data:

```typescript
// Maintains real-time synchronized stores for:
// - Items (parts/products)
// - Customers
// - Suppliers
// - Employees (people)

// These are available via Zustand hooks:
import { useItems, useCustomers, useSuppliers, usePeople } from "~/stores";
```

### 3. Filtered Subscriptions

Subscribe to specific records:

```typescript
// Only listen to changes for a specific order
useRealtime("salesOrder", `id=eq.${orderId}`);

// Listen to orders in a specific status
useRealtime("salesOrder", `status=eq.released`);
```

## Multi-Tenant Isolation

All realtime subscriptions should filter by companyId to ensure tenant isolation:

```typescript
.on("postgres_changes", {
  event: "*",
  schema: "public",
  table: "salesOrder"
}, (payload) => {
  // Check companyId on new/updated records
  if ("companyId" in payload.new && payload.new.companyId !== company.id) {
    return; // Ignore changes from other companies
  }

  // Process the change
});
```

## Performance Considerations

1. **Channel Reuse**: Create one channel per logical group of subscriptions rather than one per table
2. **Event Filtering**: Use database-level filters where possible (`filter: "status=eq.active"`)
3. **Cleanup**: Always unsubscribe in useEffect cleanup functions
4. **Token Updates**: Update auth token when accessToken changes but avoid recreating channels

## Troubleshooting

### Common Issues

**Subscriptions not receiving events:**

- Ensure `carbon.realtime.setAuth(accessToken)` is called before subscribing
- Check that accessToken is defined and valid
- Verify RLS policies allow the user to SELECT the table
- Confirm the table has REPLICA IDENTITY FULL (for DELETE events)

**Multiple event firings:**

- Make sure channels are properly cleaned up in useEffect return
- Use `channelRef` to prevent creating duplicate channels
- Check dependency arrays in useEffect hooks

**Events from wrong company:**

- Always filter events by companyId in the event handler
- Don't rely solely on database filters for multi-tenant isolation

## Related Files

- `/packages/auth/src/lib/supabase/client.ts` - Supabase client creation
- `/packages/auth/src/lib/supabase/provider.tsx` - Carbon provider with accessToken
- `/apps/erp/app/hooks/useRealtime.tsx` - Reusable realtime hook
- `/apps/erp/app/components/RealtimeDataProvider.tsx` - Core data provider
- `/apps/mes/app/hooks/useRealtime.tsx` - MES realtime hook
- `/apps/mes/app/components/RealtimeDataProvider.tsx` - MES data provider

## Database Patterns Documentation

For more details on database patterns including realtime subscriptions, see:

- `carbon/llm/cache/database-patterns.md` (lines 127-144)
