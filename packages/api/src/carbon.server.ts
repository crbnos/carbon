// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The ERP's router, bound to a caller: `registerCarbon` hands it to
// `registerApi` (`@carbon/auth/auth.server`), so `authorize(request)` returns
// `api`. Plus `respond(request, result)` for a form that navigates. The app
// passes its router in, so this package never imports app code.

import { error, success } from "@carbon/auth";
import { type CallerAuth, registerApi } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { z } from "zod";
import {
  type RouteResult,
  type ServiceContext,
  type ServiceFn,
  toResult
} from "./service-fn.server";

export { dataOrThrow } from "./service-fn.server";

/** A tree of service functions, each bound to one caller. */
export type Api<T> = {
  [K in keyof T]: T[K] extends ServiceFn<infer I, infer _R>
    ? (input: z.input<I>) => Promise<RouteResult<Awaited<ReturnType<T[K]>>>>
    : Api<T[K]>;
};

/**
 * Called once at server start: the app's router, and its context for a
 * caller. The app states `api`'s type on `Register` (`@carbon/auth/auth.server`).
 */
export function registerCarbon<R extends object>(setup: {
  router: R;
  context: (auth: CallerAuth) => ServiceContext;
}) {
  registerApi((auth) => bindServiceFns(setup.router, setup.context(auth)));
}

// ponytail: a Proxy per namespace read; bind eagerly if a hot path ever shows it.
/** Every service function under `node`, called with `ctx` and returned as a route sends it. */
export function bindServiceFns<T extends object>(
  node: T,
  ctx: ServiceContext
): Api<T> {
  return new Proxy(node, {
    get(target, key) {
      const child = Reflect.get(target, key);
      if (typeof child === "function") {
        const fn = child as unknown as ServiceFn<z.ZodType, unknown>;
        return (input: unknown) => fn(ctx, input).then(toResult);
      }
      if (child !== null && typeof child === "object") {
        return bindServiceFns(child, ctx);
      }
      return child;
    }
  }) as Api<T>;
}

/**
 * The response to a form that NAVIGATES (no fetcher, so no `useAction` to
 * toast the result): `respond(request, result).redirect(to, { message })`
 * redirects with the result's error, or with `message`, as the flash; a
 * refused call goes to `onError` when given. A form submitted through a
 * fetcher returns the result instead.
 */
export function respond(
  request: Request,
  result: { error: { message: string } | null }
) {
  return {
    async redirect(
      to: string,
      { message, onError }: { message?: string; onError?: string } = {}
    ): Promise<never> {
      if (result.error) {
        throw redirect(
          onError ?? to,
          await flash(request, error(null, result.error.message))
        );
      }
      if (message) throw redirect(to, await flash(request, success(message)));
      throw redirect(to);
    }
  };
}
