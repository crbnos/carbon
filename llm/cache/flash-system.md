# Session Flash Message System

## Overview

Carbon uses a session-based flash message system to display success/error notifications to users. The system consists of three main components:

1. Server-side flash session management
2. Toast notifications for general feedback
3. Flash overlay for MES-specific visual feedback

## Core Implementation

### 1. Flash Type Definition

**Location:** `carbon/packages/auth/src/types.ts`

```typescript
export type Result = {
  success: boolean;
  message?: string;
  flash?: "success" | "error";
};
```

The `Result` type has three properties:

- `success`: Boolean indicating operation success/failure
- `message`: Optional message to display to user
- `flash`: Optional visual flash effect (only used in MES app)

### 2. Server-Side Flash Functions

**Location:** `carbon/packages/auth/src/services/session.server.ts`

#### Setting Flash Messages

```typescript
export async function flash(request: Request, result: Result) {
  const session = await getSession(request);
  if (typeof result.success === "boolean") {
    session.flash("success", result.success);
    session.flash("message", result.message);
    if (result.flash) {
      session.flash("flash", result.flash);
    }
  }

  return {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  };
}
```

**How it works:**

1. Retrieves the current session from the request
2. Uses Remix's `session.flash()` to store temporary data that will be cleared after being read once
3. Stores three pieces of data: `success` (boolean), `message` (string), and optionally `flash` (visual effect type)
4. Returns headers to commit the session cookie

#### Reading Flash Messages

```typescript
export async function getSessionFlash(request: Request) {
  const session = await getSession(request);

  const result: Result = {
    success: session.get("success") === true,
    message: session.get("message"),
    flash: session.get("flash") as "success" | "error" | undefined,
  };

  if (!result.message) return null;

  const headers = { "Set-Cookie": await sessionStorage.commitSession(session) };

  return { result, headers };
}
```

**How it works:**

1. Reads flash data from the session
2. Returns null if there's no message (prevents empty flashes)
3. Commits the session, which clears the flash data (single-use nature)
4. Returns both the result and headers

### 3. Helper Functions

**Location:** `carbon/packages/auth/src/utils/result.ts`

```typescript
export function error(error: any, message = "Request failed"): Result {
  if (error) console.error({ error, message });
  return {
    success: false,
    message: message,
  };
}

export function success(message = "Request succeeded", data?: any): Result {
  return {
    success: true,
    message,
  };
}
```

These utility functions create properly formatted `Result` objects:

- `error()`: Creates a failure result, logs the error to console
- `success()`: Creates a success result

## Usage Patterns

### Pattern 1: Flash with Redirect (Most Common)

```typescript
export async function action({ request }: ActionFunctionArgs) {
  // ... perform operation

  if (operationFailed) {
    return json(
      {},
      await flash(request, error(operationError, "Operation failed"))
    );
  }

  // Redirect with success flash
  throw redirect(
    "/destination",
    await flash(request, success("Operation succeeded"))
  );
}
```

**Key points:**

- Use `throw redirect()` with flash headers to redirect and show message
- The flash headers must be included in the redirect response

### Pattern 2: Flash with JSON Response

```typescript
export async function action({ request }: ActionFunctionArgs) {
  // ... perform operation

  return json(
    operationData,
    await flash(request, {
      ...success("Operation succeeded"),
      flash: "success", // Optional: adds visual flash effect
    })
  );
}
```

**Key points:**

- Use `json()` to return data along with flash
- Can optionally add `flash: "success"` or `flash: "error"` for visual effects (MES only)

### Pattern 3: Flash with Visual Overlay (MES App Only)

```typescript
return json(
  data,
  await flash(request, {
    ...success("Production quantity recorded"),
    flash: "success", // Triggers green flash overlay
  })
);

// Or for errors:
return json(
  data,
  await flash(request, {
    ...error(err, "Operation failed"),
    flash: "error", // Triggers red flash overlay
  })
);
```

## Client-Side Display

### 1. Root Loader Pattern

All apps must retrieve flash messages in their root loader:

```typescript
export async function loader({ request }: LoaderFunctionArgs) {
  const sessionFlash = await getSessionFlash(request);

  return json(
    {
      // ... other data
      result: sessionFlash?.result,
    },
    {
      headers: sessionFlash?.headers, // CRITICAL: Must return headers
    }
  );
}
```

**IMPORTANT:** Always return the `sessionFlash.headers` in the loader response. This commits the session and ensures the flash data is cleared after being read.

### 2. Toast Notifications (Standard Display)

**Location:** Root component of any app (e.g., `carbon/apps/mes/app/root.tsx`)

```typescript
export default function App() {
  const loaderData = useLoaderData<typeof loader>();
  const result = loaderData?.result;

  /* Toast Messages */
  useEffect(() => {
    if (result?.success === true) {
      toast.success(result.message);
    } else if (result?.message) {
      toast.error(result.message);
    }
  }, [result]);

  return (
    <Document>
      <Outlet />
      <Toaster position="bottom-right" visibleToasts={5} />
    </Document>
  );
}
```

**How it works:**

1. Effect runs when `result` changes
2. Shows success toast if `result.success === true`
3. Shows error toast if there's a message (and not success)
4. `<Toaster>` component renders the toast notifications

### 3. Flash Overlay (MES App Only)

**Location:** `carbon/apps/mes/app/components/FlashOverlay.tsx`

The MES app includes a visual flash overlay for tactile feedback:

```typescript
export default function App() {
  const loaderData = useLoaderData<typeof loader>();
  const result = loaderData?.result;

  /* Flash Overlay */
  useEffect(() => {
    if (result?.flash) {
      flashOverlay.flash(result.flash);
    }
  }, [result?.flash]);

  return (
    <Document>
      <Outlet />
      <FlashOverlay />
    </Document>
  );
}
```

**Flash Overlay Features:**

- Green radial gradient for success
- Red radial gradient for error
- Plays victory sound on success (`/victory.mp3`)
- Auto-dismisses after 300ms
- Uses pub/sub pattern via `FlashOverlayManager`

## Common Issues and Solutions

### Issue 1: Flash Message Not Displaying

**Symptoms:** Action completes but no toast appears

**Common Causes:**

1. Missing headers in root loader response

   ```typescript
   // ❌ WRONG
   return json({ result: sessionFlash?.result });

   // ✅ CORRECT
   return json(
     { result: sessionFlash?.result },
     { headers: sessionFlash?.headers }
   );
   ```

2. Not using `throw redirect()` with flash

   ```typescript
   // ❌ WRONG
   redirect("/path", await flash(request, success("Done")));

   // ✅ CORRECT
   throw redirect("/path", await flash(request, success("Done")));
   ```

3. Missing root loader flash retrieval

   ```typescript
   // ❌ WRONG - No getSessionFlash call
   export async function loader({ request }: LoaderFunctionArgs) {
     return json({});
   }

   // ✅ CORRECT
   export async function loader({ request }: LoaderFunctionArgs) {
     const sessionFlash = await getSessionFlash(request);
     return json(
       { result: sessionFlash?.result },
       { headers: sessionFlash?.headers }
     );
   }
   ```

### Issue 2: Flash Shows on Wrong Page

**Symptom:** Message appears on different page than expected

**Cause:** Flash messages persist across redirects until displayed. If the root loader doesn't properly consume them, they can leak to subsequent pages.

**Solution:** Always ensure root loader gets and returns flash headers to clear them.

### Issue 3: Multiple Flash Messages

**Symptom:** Multiple toasts appear for single action

**Cause:** Using both `json()` and `redirect()` with flash, or multiple flash calls

**Solution:** Use flash only once per action:

```typescript
// ❌ WRONG
await flash(request, success("Part 1"));
await flash(request, success("Part 2"));

// ✅ CORRECT
await flash(request, success("Operation completed"));
```

### Issue 4: Flash Overlay Not Working (MES)

**Symptom:** Toast shows but no visual flash

**Cause:** Missing `flash` property in result

**Solution:**

```typescript
// ❌ WRONG
await flash(request, success("Done"));

// ✅ CORRECT (for visual flash)
await flash(request, {
  ...success("Done"),
  flash: "success",
});
```

## Best Practices

1. **Always include message**: Even for redirects, include a meaningful message

   ```typescript
   throw redirect(path.to.list, await flash(request, success("Item created")));
   ```

2. **Use helper functions**: Always use `success()` and `error()` helpers

   ```typescript
   // ✅ GOOD
   await flash(request, success("Saved"));

   // ❌ BAD
   await flash(request, { success: true, message: "Saved" });
   ```

3. **Return headers properly**: For JSON responses, return as second argument

   ```typescript
   return json(data, await flash(request, result));
   ```

4. **Use visual flash sparingly**: Only use `flash: "success"/"error"` for important MES operations

   ```typescript
   // Use for: completing production, scrapping items
   flash: "success";

   // Don't use for: form saves, minor updates
   ```

5. **Handle errors consistently**: Always show error messages
   ```typescript
   if (result.error) {
     return json(
       {},
       await flash(request, error(result.error, "Failed to save"))
     );
   }
   ```

## Implementation Checklist

When adding flash messages to a new app:

- [ ] Import `getSessionFlash` in root loader
- [ ] Call `getSessionFlash(request)` in root loader
- [ ] Return `sessionFlash?.result` in loader data
- [ ] Return `sessionFlash?.headers` in loader headers
- [ ] Add `useEffect` to display toasts based on `result`
- [ ] Include `<Toaster>` component in Document
- [ ] (Optional - MES) Add flash overlay for visual feedback
- [ ] Test both success and error scenarios
- [ ] Verify flash clears after display (doesn't persist)

## Related Files

**Core Flash System:**

- `carbon/packages/auth/src/types.ts` - Type definitions
- `carbon/packages/auth/src/services/session.server.ts` - Flash functions
- `carbon/packages/auth/src/utils/result.ts` - Helper functions

**Example Implementations:**

- `carbon/apps/mes/app/root.tsx` - MES app with overlay
- `carbon/apps/mes/app/routes/x+/complete.tsx` - Action with flash
- `carbon/apps/mes/app/components/FlashOverlay.tsx` - Visual overlay component

**Other Patterns:**

- `carbon/llm/cache/shipments-receipts-ui-patterns.md` - Mentions flash for errors
- `carbon/llm/cache/clientAction-patterns.md` - Client-side validation with flash
