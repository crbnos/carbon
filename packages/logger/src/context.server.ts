import { AsyncLocalStorage } from "node:async_hooks";
import {
  createContext,
  type MiddlewareFunction,
  type RouterContext,
  type RouterContextProvider
} from "react-router";

/**
 * Makes React Router's per-request `context` readable from anywhere on the
 * server, without threading it through every function signature.
 *
 * React Router already gives each request a `RouterContextProvider` and hands it
 * to middleware, loaders and actions. What it does not give you is a way to read
 * it from a plain service function — so anything that wants request-scoped state
 * (`requirePermissions`, a logger, a DB client) has to take `context` as an
 * argument, which for an existing codebase means touching every call site.
 *
 * Storing the provider itself in an AsyncLocalStorage closes that gap: ALS
 * propagates through the async call tree, so every loader running inside
 * `next()` — and everything they call — can reach the same provider. The values
 * still live in React Router's own typed `createContext` slots; ALS only
 * provides the access path.
 *
 * Safety: the provider is per-request and ALS gives each concurrent request its
 * own store, so one request can never observe another's values. Outside a
 * request (Inngest jobs, edge functions, tests) `getRouterContext()` is
 * undefined and callers fall back to computing directly.
 *
 * A WeakMap keyed on the `Request` does NOT work as a substitute: React Router
 * does not hand the same Request instance to every matched loader, so such a
 * memo never hits (measured — no change in per-request claim lookups).
 */
// Middleware hands `context` as Readonly<…>; its get/set methods stay callable.
type RequestContext = Readonly<RouterContextProvider>;

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Publishes the request's context provider to `getRouterContext()`.
 *
 * Register FIRST in an app's root `middleware` array, so every downstream
 * middleware and handler runs inside the scope.
 */
export const requestContextMiddleware: MiddlewareFunction<Response> = (
  { context, request },
  next
) => {
  context.set(isReadRequestContext, READ_METHODS.has(request.method));
  return storage.run(context, () => next());
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether this request only reads — see `oncePerRead`. */
const isReadRequestContext = createContext<boolean>(false);

/** The current request's context provider, or undefined outside a request. */
export function getRouterContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Read a `createContext` value for the current request from anywhere.
 * Returns `undefined` outside a request scope.
 */
export function getRequestContext<T>(context: RouterContext<T>): T | undefined {
  return storage.getStore()?.get(context);
}

/** Backing store for `oncePerRequest`, kept in the router context itself. */
const memoContext = createContext<Map<string, unknown> | null>(null);

/**
 * Compute a value at most once per request.
 *
 * Every matched route resolves the same request-scoped values independently — a
 * detail page's five loaders each looked up the same permission claims and built
 * their own Supabase client. Keyed memoization collapses that to one.
 *
 * Promises are cached as promises (not awaited results) so concurrent loaders
 * share a single in-flight lookup rather than racing to populate the entry.
 *
 * Outside a request scope this simply calls `compute()` every time.
 */
export function oncePerRequest<T>(key: string, compute: () => T): T {
  const provider = storage.getStore();
  if (!provider) return compute();

  let memo = provider.get(memoContext);
  if (!memo) {
    memo = new Map<string, unknown>();
    provider.set(memoContext, memo);
  }
  if (!memo.has(key)) {
    memo.set(key, compute());
  }
  return memo.get(key) as T;
}

/**
 * Like `oncePerRequest`, but ONLY on a request that just reads.
 *
 * Use this for anything derived from database state — permission claims, an
 * order, a job — rather than `oncePerRequest`. React Router runs an action and
 * the loader revalidation that follows it in the SAME request, so a plain
 * per-request memo would hand the revalidating loaders whatever was read before
 * the action wrote: a stale render, or a permission gate passing on claims the
 * action just revoked. On any mutating method this is a pass-through.
 *
 * `oncePerRequest` remains correct for values that are not database state — a
 * Supabase client is interchangeable regardless of what the request does.
 */
export function oncePerRead<T>(key: string, compute: () => T): T {
  const provider = storage.getStore();
  if (!provider?.get(isReadRequestContext)) return compute();
  return oncePerRequest(key, compute);
}

/** Test seam: how many values the current request has memoized. */
export function requestMemoSize(): number {
  return storage.getStore()?.get(memoContext)?.size ?? 0;
}

/** Test seam: run `fn` inside a fresh request scope, as the middleware would. */
export function runInRequestContext<T>(
  provider: RequestContext,
  fn: () => T,
  options?: { isRead?: boolean }
): T {
  provider.set(isReadRequestContext, options?.isRead ?? true);
  return storage.run(provider, fn);
}
