import type { MiddlewareFunction } from "react-router";
import { resolveAuthContext } from "../services/auth.server";
import { AuthClientScope, AuthContextHolder } from "../services/auth-context";

// Establishes the per-request AuthContextHolder scope ONCE, for every route
// (including resource routes like `api+/mcp+` — verified: RR root middleware
// runs for resource loaders/actions under v8_middleware). Identity is
// resolved by `resolveAuthContext`, the same code `requirePermissions` reads
// from — so the two cannot diverge (console pin-in attribution stays correct).
//
// `client` is intentionally NOT set here: it is the RLS-scoped Supabase
// handle, route-specific (depends on `requiredPermissions.bypassRls`), built
// by `requirePermissions` and passed explicitly as a service-fn parameter.
// Carrying it would reintroduce the cross-tenant-leak surface this design
// removes.
//
// Public / unauthenticated routes: `resolveAuthContext` returns null → we
// run WITHOUT opening a scope, so `AuthContextHolder.get()` fails closed if
// (and only if) some code actually reads identity. Public route code never
// does, so this is correct and side-effect free.
export const authContextMiddleware: MiddlewareFunction<Response> = async (
  { request },
  next
) => {
  // Open an EMPTY client scope for every request (cheap, no client built).
  // requirePermissions fills the authorized client factory later, before any
  // service code runs; getAuthClient() builds it lazily on first use. This
  // is opened even for unauthenticated requests because some public routes
  // still call requirePermissions for optional auth.
  return AuthClientScope.run(async () => {
    const identity = await resolveAuthContext(request);
    if (!identity) {
      // No session: no identity scope. getAuthClient()/AuthContextHolder.get()
      // fail closed only if some code actually reads them (public route
      // code does not).
      return next();
    }
    return AuthContextHolder.run(
      {
        // Identity context carries no client. The lazy AuthClientScope
        // (set by requirePermissions) is the sole client source.
        client: undefined,
        userId: identity.userId,
        sessionUserId: identity.sessionUserId,
        email: identity.email,
        companyId: identity.companyId,
        companyGroupId: identity.companyGroupId,
        apiKeyRecord: identity.apiKeyRecord
      },
      () => next()
    );
  });
};
