// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The ERP's router, bound to a caller: `registerCarbon` hands it to
// `registerApi` (`@carbon/auth/auth.server`), so `authorize(request)` returns
// `api`. Plus `respond(request, result)` for a form that navigates. The app
// passes its router in, so this package never imports app code.

import { error, success } from "@carbon/auth";
import { type CallerAuth, registerApi } from "@carbon/auth/auth.server";
import { flash, flashData } from "@carbon/auth/session.server";
import { type FailureReason, type FormError, redirect } from "@carbon/utils";
import type { z } from "zod";
import {
  NO_ORIGIN,
  originOf,
  type RequestOrigin,
  type RouteResult,
  type ServiceContext,
  type ServiceFn,
  toResult
} from "./service-fn.server";
import { staysOnForm } from "./stay-on-form";

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
 * The context takes where the request came from (`originOf`), so an operation
 * reads `ctx.origin` and never an input field for it; a caller no request
 * made gets `NO_ORIGIN`.
 */
export function registerCarbon<R extends object>(setup: {
  router: R;
  context: (auth: CallerAuth, origin: RequestOrigin) => ServiceContext;
}) {
  registerApi((auth, request) =>
    bindServiceFns(
      setup.router,
      setup.context(auth, request ? originOf(request) : NO_ORIGIN)
    )
  );
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
 * redirects with `message` as the flash. A refused POST from the page that
 * owns the action stays on its form, with the error as the flash and as
 * `{ formError }` (shown by `ValidatedForm`), so what was typed is kept. It
 * goes to `onError` instead when given; a loader, or a post from another page
 * to an action-only route, still redirects (`staysOnForm`). A form submitted through a
 * fetcher returns the result instead.
 */
export function respond(
  request: Request,
  result: {
    error: { message: string; title?: string; reason?: FailureReason } | null;
  }
) {
  return {
    async redirect(
      to: string,
      {
        message,
        description,
        onError
      }: { message?: string; description?: string; onError?: string } = {}
    ): Promise<never> {
      if (result.error) {
        const failure = {
          ...error(null, result.error.title ?? result.error.message),
          ...(result.error.reason && { reason: result.error.reason })
        };
        if (onError || !staysOnForm(request)) {
          throw redirect(onError ?? to, await flash(request, failure));
        }
        const formError: FormError = {
          message: failure.message ?? result.error.message,
          reason: result.error.reason ?? null
        };
        // Typed `never` like the redirects: only the form reads `formError`, never the route.
        return flashData(request, failure, { formError }) as unknown as never;
      }
      if (message) {
        throw redirect(
          to,
          await flash(request, {
            ...success(message),
            ...(description && { description })
          })
        );
      }
      throw redirect(to);
    }
  };
}
