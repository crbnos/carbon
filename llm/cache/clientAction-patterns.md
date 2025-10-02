# ClientAction Implementation Patterns

## Overview

ClientAction is a Remix feature used to handle client-side operations before calling the server action. In this codebase, it's primarily used for cache invalidation with React Query.

## Common Patterns

### 1. Cache Invalidation with Predicate (Delete Operations)

**File**: `carbon/apps/erp/app/routes/x+/inventory+/shelves.delete.$shelfId.tsx`

```typescript
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return queryKey[0] === "shelves" && queryKey[1] === companyId;
    },
  });

  return await serverAction();
}
```

### 2. Setting Query Data to Null (Update Operations)

**File**: `carbon/apps/erp/app/routes/x+/resources+/work-centers.$id.tsx`

```typescript
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    workCentersQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}
```

### 3. Setting Query Data to Null (Create Operations)

**File**: `carbon/apps/erp/app/routes/x+/items+/uom.new.tsx`

```typescript
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(uomsQuery(getCompanyId()).queryKey, null);

  return await serverAction();
}
```

### 4. Conditional Cache Updates Based on Form Data

**File**: `carbon/apps/erp/app/routes/x+/supplier+/$supplierId.processes.new.tsx`

```typescript
export async function clientAction({
  request,
  serverAction,
  params,
}: ClientActionFunctionArgs) {
  const formData = await request.clone().formData(); // if we. don't clone it we can't access it in the action
  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  if (validation.data.processId) {
    window.clientCache?.setQueryData(
      supplierProcessesQuery(validation.data.processId).queryKey,
      null
    );
  }
  return await serverAction();
}
```

## Key Principles

1. **Always call serverAction()**: ClientAction should always call the server action after handling client-side operations
2. **Cache invalidation patterns**:
   - Use `invalidateQueries` with predicates for bulk invalidation (common in delete operations)
   - Use `setQueryData(queryKey, null)` for specific query invalidation (common in create/update operations)
3. **Error handling**: ClientAction can handle validation errors before hitting the server
4. **Form data access**: Use `request.clone().formData()` if you need to access form data in both clientAction and serverAction
5. **Safety checks**: Always use optional chaining (`window?.clientCache?.`) since clientCache might not be available
6. **Company scoping**: Most queries are scoped by company ID using `getCompanyId()`

## Import Requirements

```typescript
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { getCompanyId } from "~/utils/react-query";
```
