// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { z } from "zod";
import { type Router, router } from "./router.server";
import { serviceContext } from "./service-context.server";
import {
  type RouteResult,
  type ServiceContext,
  type ServiceFn,
  toResult
} from "./service-fn.server";

export type Api<T> = {
  [K in keyof T]: T[K] extends ServiceFn<infer I, infer _R>
    ? (input: z.input<I>) => Promise<RouteResult<Awaited<ReturnType<T[K]>>>>
    : Api<T[K]>;
};

// ponytail: a Proxy per namespace read; bind eagerly if a hot path ever shows it.
function bind<T extends object>(node: T, ctx: ServiceContext): Api<T> {
  return new Proxy(node, {
    get(target, key) {
      const child = Reflect.get(target, key);
      if (typeof child === "function") {
        const fn = child as unknown as ServiceFn<z.ZodType, unknown>;
        return (input: unknown) => fn(ctx, input).then(toResult);
      }
      if (child !== null && typeof child === "object") return bind(child, ctx);
      return child;
    }
  }) as Api<T>;
}

/**
 * The operations, bound to this request's caller: `api.production.job.cancel(input)`.
 * Each call is checked against its own permission, and returns its result as
 * the route sends it.
 */
export async function carbon(request: Request): Promise<Api<Router>> {
  return bind(router, serviceContext(await requirePermissions(request, {})));
}
