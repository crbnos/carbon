---
description: Flash (toast) session-message system — flash/error/success API, cookie mechanism, and middleware-based toast rendering
paths:
  - "packages/auth/src/services/session.server.ts"
  - "packages/auth/src/middleware/flash.*.ts"
  - "packages/auth/src/utils/result.ts"
  - "apps/*/app/root.tsx"
---

# Flash (Toast) System

Carbon shows success/error toasts via a single-use **session flash cookie**. An action
writes a `Result` into the session; the next request reads it once (it auto-clears) and a
client middleware fires the toast. Defined in `@carbon/auth`, consumed by every app
(`erp`, `mes`, `academy`, `starter`).

## API (`@carbon/auth`)

```ts
import { error, success } from "@carbon/auth";          // result.ts (re-exported via index)
import { flash } from "@carbon/auth/session.server";     // session.server.ts
```

- `success(message = "Request succeeded", data?): Result` → `{ success: true, message }`.
  Note: the `data` arg is accepted but **ignored** (not returned).
- `error(error: any, message = "Request failed"): Result` → `{ success: false, message }`.
  Logs `console.error({ error, message })` when `error` is truthy.
- `flash(request, result): Promise<{ headers: { "Set-Cookie": ... } }>` — commits the
  result into the `carbon` session cookie and returns a `ResponseInit`-shaped object you
  spread as the response's second arg.
- `Result` type (`packages/auth/src/types.ts`):
  `{ success: boolean; message?: string; flash?: "success" | "error" }`.

## Usage in actions

`flash(...)` returns `{ headers }`, so pass it as the response init. Use `data(...)` /
plain objects and `redirect(...)` from `react-router` — **not** the old Remix `json(...)`.

```ts
// Service error → stay on page, show error toast
if (result.error) {
  return data({}, await flash(request, error(result.error, "Failed to create")));
}
// Success → throw a redirect carrying the flash headers
throw redirect(path.to.things, await flash(request, success("Created")));
```

- One `flash` call per response (the cookie holds a single message).
- On success, **`throw redirect(...)`** with the flash headers (not `return redirect`).
- Validation failures use `validationError(validation.error)` instead (no flash).

## How the toast renders (middleware, not a component `useEffect`)

Each app's `root.tsx` registers both middlewares and threads the result through React
Router request `context`:

```ts
import {
  flashMiddleware, flashClientMiddleware,
  flashResultContext, flashHeadersContext,
} from "@carbon/auth/middleware/flash.server"; // + .../flash.client for the client one

export const middleware = [flashMiddleware];
export const clientMiddleware = [flashClientMiddleware];

// in the root loader:
return data(
  { /* ... */, result: context.get(flashResultContext) },
  { headers: context.get(flashHeadersContext) ?? undefined }
);
```

- `flashMiddleware` (server) calls `getSessionFlash(request)` and puts the result +
  `Set-Cookie` headers into context. The root loader must surface both — returning the
  headers is what commits the cleared session so the flash doesn't leak to the next page.
- `flashClientMiddleware` (client) reads `root` route data after `next()` and calls
  `toast.success(result.message)` / `toast.error(result.message)` from `@carbon/react`.
  The toast fire lives here — there is **no** `useEffect`-on-`result` in the root
  component anymore.
- `getSessionFlash` returns `null` when there is no `message`, so empty flashes never toast.

## Gotchas

- Root loader must return BOTH `result` (from `flashResultContext`) and the headers
  (from `flashHeadersContext`); dropping the headers means the cookie never clears and the
  message reappears on the next navigation.
- `flash()` only writes when `typeof result.success === "boolean"` — always go through
  `success()` / `error()`.
- The `Result.flash` field (`"success" | "error"`) is still plumbed through
  `flash`/`getSessionFlash`, but currently **nothing consumes it**:
  `apps/mes/app/components/FlashOverlay.tsx` (radial-gradient overlay + `victory.mp3`,
  300ms) exists but is **orphaned** — `flashOverlay.flash()` is never called and
  `<FlashOverlay />` is not rendered in MES root. Treat the visual-overlay path as dead
  code, not an active feature. <!-- UNVERIFIED: whether the overlay is intended to be re-wired -->
