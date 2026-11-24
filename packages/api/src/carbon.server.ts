// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What a route calls: `carbon(request)` for the operations bound to its
// caller, and `respond(request, result)` for a form that navigates. The app
// registers its router once (`registerCarbon`), and states its type through
// `Register`, so this package never imports app code.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash, flashData } from "@carbon/auth/session.server";
import { type FailureReason, type FormError, redirect } from "@carbon/utils";
import type { z } from "zod";
import {
  originOf,
  type RequestOrigin,
  type RouteResult,
  type ServiceContext,
  type ServiceFn,
  toResult
} from "./service-fn.server";
import { staysOnForm } from "./stay-on-form";

/**
 * The app's router type. The app adds it once:
 * `declare module "@carbon/api/carbon.server" { interface Register { router: Router } }`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the app
export interface Register {}

type RegisteredRouter = Register extends { router: infer R } ? R : object;

/** An authenticated caller, as `requirePermissions` (or another gate) states it. */
export type CallerAuth = Pick<
  Awaited<ReturnType<typeof requirePermissions>>,
  | "client"
  | "companyId"
  | "companyGroupId"
  | "userId"
  | "caller"
  | "permissions"
>;

/** A tree of service functions, each bound to one caller. */
export type Api<T> = {
  [K in keyof T]: T[K] extends ServiceFn<infer I, infer _R>
    ? (input: z.input<I>) => Promise<RouteResult<Awaited<ReturnType<T[K]>>>>
    : Api<T[K]>;
};

let registered: {
  router: object;
  context: (auth: CallerAuth, origin: RequestOrigin) => ServiceContext;
} | null = null;

/** Called once at server start: the app's router, and its context for a caller. */
export function registerCarbon(setup: {
  router: RegisteredRouter;
  context: (auth: CallerAuth, origin: RequestOrigin) => ServiceContext;
}) {
  registered = setup;
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
 * The operations, bound to this request's caller: `api.production.cancelJob(input)`.
 * Each call is checked against its own permission, and returns its result as
 * the route sends it. The context carries the request's origin (`originOf`).
 */
export async function carbon(request: Request): Promise<Api<RegisteredRouter>> {
  return carbonFor(await requirePermissions(request, {}), originOf(request));
}

/**
 * `carbon()` for a caller a route authenticated another way, such as the
 * Onshape panel's bearer token (`requireOnshapePanelPermissions`).
 */
export function carbonFor(
  auth: CallerAuth,
  origin: RequestOrigin = {}
): Api<RegisteredRouter> {
  if (!registered) {
    throw new Error("carbon(): the app has not called registerCarbon");
  }
  return bindServiceFns(
    registered.router as RegisteredRouter & object,
    registered.context(auth, origin)
  );
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
