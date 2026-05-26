import type { MiddlewareFunction } from "react-router";
import { resolveAuthContext } from "../services/auth.server";
import {
  AuthClientScope,
  AuthContextHolder
} from "../services/auth-context.server";

// Opens an empty AuthClientScope for every request. This is a lightweight
// per-request AsyncLocalStorage cell (one property write) that allows
// `AuthClientScope.setFactory()` (called by `requirePermissions` and other
// routes that build a Supabase client) to work. Without this scope, those
// calls fail closed.
//
// Must be at root level so it cascades to all routes including resource
// routes (api+/*, file+/*) which RR-7 root middleware covers under
// v8_middleware.
export const clientScopeMiddleware: MiddlewareFunction<Response> = async (
  _args,
  next
) => {
  return AuthClientScope.run(next);
};

// Resolves the authenticated identity ONCE per request and stores it in
// AuthContextHolder so `requirePermissions` reads from ALS instead of
// re-reading cookies / re-fetching API keys. Only routes that protect
// resources should use this — apply at module level in protected layouts.
//
// `client` is intentionally NOT set here. It is the RLS-scoped Supabase
// handle — route-specific because it depends on `requiredPermissions.bypassRls`.
// `requirePermissions` decides and registers the client factory; service
// code reads it lazily via `getAuthClient()`.
//
// For unauthenticated requests on public routes: `resolveAuthContext` returns
// `null` and we run `next()` without an identity scope. Any code that reads
// `AuthContextHolder.get()` fails closed — correct for public routes.
export const authContextMiddleware: MiddlewareFunction<Response> = async (
  { request },
  next
) => {
  const identity = await resolveAuthContext(request);
  if (!identity) return next();
  return AuthContextHolder.run({ ...identity, client: undefined }, next);
};
