// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Api, bindServiceFns } from "@carbon/api/service-fn.server";
import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { type Router, router } from "./router.server";
import { serviceContext } from "./service-context.server";

/**
 * The operations, bound to this request's caller: `api.production.job.cancel(input)`.
 * Each call is checked against its own permission, and returns its result as
 * the route sends it.
 */
export async function carbon(request: Request): Promise<Api<Router>> {
  return bindServiceFns(
    router,
    serviceContext(await requirePermissions(request, {}))
  );
}

/**
 * For a route whose form NAVIGATES (no fetcher, so no `useAction` to toast a
 * returned result): redirect, with the result's error or `message` as the
 * flash. A form submitted through a fetcher returns the result instead.
 */
export async function redirectWithResult(
  request: Request,
  result: { error: { message: string } | null },
  { to, message }: { to: string; message?: string }
): Promise<never> {
  if (result.error) {
    throw redirect(to, await flash(request, error(null, result.error.message)));
  }
  if (message) throw redirect(to, await flash(request, success(message)));
  throw redirect(to);
}
