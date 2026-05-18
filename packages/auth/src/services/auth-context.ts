import { AsyncLocalStorage } from "node:async_hooks";

// Per-request authentication context. Server-controlled state, never
// caller-supplied — established once per request by the auth middleware
// (and by the MCP executor for the MCP path) via `run()`.
//
// Lives in `@carbon/auth` (not an app) because `requirePermissions` — a
// shared package export consumed by ERP, MES and academy — reads it. A
// package cannot import from an app, so this is the canonical home; the
// ERP `~/services/mcp/auth-context` module re-exports it for back-compat.
export interface AuthContext {
  // Typed as `unknown` on purpose: this module must not depend on the
  // Supabase/Database types (it sits below the service layer). Callers
  // re-narrow with their own `SupabaseClient<Database>` at the use site.
  client: unknown;
  // Effective user — console "pin-in" aware (see getEffectiveUser in
  // auth.server.ts). On a shared shop-floor terminal this is the pinned-in
  // operator, NOT the session account. Service code attributes work to this.
  userId: string;
  // The raw logged-in / console account. Differs from `userId` in console
  // mode; kept for audit ("which terminal/account was used").
  sessionUserId: string;
  companyId: string;
  // Derived from companyId (a company has exactly one group). Group-scoped
  // service code (e.g. sales quotes/orders) reads this ambiently.
  companyGroupId: string;
}

// Module-private. The store is never exported, so the only way to read the
// context is through the audited static API below — there is no handle a
// caller could use to mutate or impersonate another request's scope.
const storage = new AsyncLocalStorage<AuthContext>();

// Static-only accessor for the ambient auth context. It is intentionally not
// instantiable: there is exactly one ALS-backed context per async execution,
// not per object. AsyncLocalStorage gives each `run()` invocation an isolated
// store that propagates through awaited continuations and does NOT leak across
// concurrently-running requests — that isolation is the whole point of using
// ALS here instead of a module-level mutable singleton.
export class AuthContextHolder {
  private constructor() {}

  // Establish the context for the duration of `fn` (and everything it awaits).
  // Returns whatever `fn` returns. This is the single write path.
  static run<T>(context: AuthContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  // Mandatory read. Throws (fail closed) when no context is in scope: a
  // service function that needs identity must never silently proceed with
  // none — that would be an authorization hole, not a recoverable state.
  static get(): AuthContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        "AuthContextHolder: no auth context in scope — code that needs " +
          "identity ran outside AuthContextHolder.run() (the auth " +
          "middleware / MCP executor establishes it). This is a wiring " +
          "bug, not a recoverable condition."
      );
    }
    return ctx;
  }

  // Best-effort read for code that legitimately runs both inside and outside
  // a request scope (e.g. public/unauthenticated routes, background/boot
  // paths). Prefer `get()` everywhere a request context is required.
  static tryGet(): AuthContext | undefined {
    return storage.getStore();
  }

  static get client(): unknown {
    return AuthContextHolder.get().client;
  }

  static get userId(): string {
    return AuthContextHolder.get().userId;
  }

  static get sessionUserId(): string {
    return AuthContextHolder.get().sessionUserId;
  }

  static get companyId(): string {
    return AuthContextHolder.get().companyId;
  }

  static get companyGroupId(): string {
    return AuthContextHolder.get().companyGroupId;
  }
}

// --- Lazy request-scoped client ------------------------------------------
//
// The Supabase client is NOT carried on AuthContext (it is not identity, and
// a credential must not sit in the identity object). It lives in a separate
// per-request cell, established empty by the auth middleware and filled by
// `requirePermissions` once it has run its EXISTING, unchanged client
// decision (`bypassRls && role==="employee" ? serviceRole : rls`, or the
// api-key client). `getAuthClient()` then builds it lazily on first use and
// memoizes for the rest of the request.
//
// SECURITY: there is deliberately NO parameter on `getAuthClient()` and no
// way for service code to request a bypass. The RLS-vs-serviceRole decision
// stays in the single audited `requirePermissions` site, AND-gated by the
// server-resolved employee role. A missing factory throws (fail closed) —
// it never silently yields a client and never defaults to serviceRole.
interface ClientCell {
  // The already-authorized client builder, written by requirePermissions.
  // Lazy: not invoked until the first getAuthClient() call.
  factory?: () => unknown;
  // Memoized result of factory(), frozen for the rest of the request.
  built?: unknown;
}

const clientStorage = new AsyncLocalStorage<ClientCell>();

export class AuthClientScope {
  private constructor() {}

  // Middleware opens an EMPTY cell for the request; requirePermissions fills
  // the factory later (before any service code runs). One cell per request.
  static run<T>(fn: () => T): T {
    return clientStorage.run({}, fn);
  }

  // requirePermissions calls this with its already-decided builder. We store
  // the factory (not a built client) so construction stays lazy. Re-setting
  // before first build is allowed (e.g. requirePermissions runs once); once
  // built, the memoized client is frozen and a later set is ignored to avoid
  // a mid-request client swap.
  static setFactory(factory: () => unknown): void {
    const cell = clientStorage.getStore();
    if (!cell) {
      throw new Error(
        "AuthClientScope.setFactory: no client scope in scope — the auth " +
          "middleware must open it before requirePermissions runs."
      );
    }
    if (cell.built !== undefined) return; // already built; do not swap
    cell.factory = factory;
  }
}

// The single lazy accessor service code uses instead of receiving `client`.
export function getAuthClient<T = unknown>(): T {
  const cell = clientStorage.getStore();
  if (!cell) {
    throw new Error(
      "getAuthClient: no client scope — code ran outside the auth " +
        "middleware / requirePermissions path. This is a wiring bug."
    );
  }
  if (cell.built !== undefined) return cell.built as T;
  if (!cell.factory) {
    throw new Error(
      "getAuthClient: client not resolved — requirePermissions has not run " +
        "for this request (it sets the authorized client factory). Fail " +
        "closed: never default to a client."
    );
  }
  cell.built = cell.factory();
  return cell.built as T;
}
