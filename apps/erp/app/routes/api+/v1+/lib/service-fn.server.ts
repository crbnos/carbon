// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs a published service function (`defineServiceFn`) for an API, MCP or
// workflow caller: the same function, with the same checks, the route calls.

import type { ManifestEntry } from "@carbon/api";
import { permissionsFromClaims } from "@carbon/api/permissions";
import type {
  ErrorCategory,
  ServiceContext,
  ServiceFn
} from "@carbon/api/service-fn.server";
import { ORPCError } from "@orpc/server";
import type { z } from "zod";
import { router as services } from "~/modules/router.server";
import { contextFor } from "~/modules/service-context.server";
import type { AuthedContext } from "./base.server";
import { scopedToCompany } from "./company-scope.server";
import { COMPANY_TABLES } from "./operations.server";

/** The oRPC code each refusal goes out as; its status is the category's own. */
const CODES: Record<ErrorCategory, string> = {
  validation: "BAD_REQUEST",
  unauthenticated: "UNAUTHORIZED",
  entitlement: "PAYMENT_REQUIRED",
  forbidden: "FORBIDDEN",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  rule: "UNPROCESSABLE_CONTENT",
  rateLimited: "TOO_MANY_REQUESTS",
  internal: "INTERNAL_SERVER_ERROR",
  unavailable: "SERVICE_UNAVAILABLE"
};

function serviceFnAt(path: string[]): ServiceFn<z.ZodType, unknown> {
  let node: unknown = services;
  for (const key of path) node = (node as Record<string, unknown>)?.[key];
  if (typeof node !== "function") {
    throw new Error(`No service function at router.${path.join(".")}`);
  }
  return node as ServiceFn<z.ZodType, unknown>;
}

/**
 * The service context for an authenticated API, MCP or workflow caller. Its
 * client filters every update and delete on a company table by the caller's
 * company (`scopedToCompany`): row-level security lets a user reach every
 * company they belong to, and an id from another one must match nothing.
 */
export function contextFromAuthed(context: AuthedContext): ServiceContext {
  return contextFor({
    kind: context.authKind === "api-key" ? "apiKey" : "user",
    userId: context.userId,
    // Scopes are claims-shaped: `<module>_<action>` → company ids.
    permissions: permissionsFromClaims(context.scopes),
    companyId: context.companyId,
    companyGroupId: context.companyGroupId,
    client: scopedToCompany(context.client, context.companyId, COMPANY_TABLES)
  });
}

/** Run the operation's service function; a refusal becomes an `ORPCError`. */
export async function runServiceFn(
  meta: ManifestEntry,
  context: AuthedContext,
  input: unknown
): Promise<{ data: unknown; count?: number }> {
  const fn = serviceFnAt(meta.serviceFn.path);
  const result = await fn(contextFromAuthed(context), input);
  if (result.error) {
    const { category, message, status } = result.error;
    throw new ORPCError(CODES[category], {
      status,
      message,
      data: { category }
    });
  }
  if (meta.paginates) {
    // A `paged` result: the rows go out as the list, the total beside them.
    const { rows, count } = result.data as {
      rows: unknown;
      count: number | null;
    };
    return { data: rows, ...(count !== null ? { count } : {}) };
  }
  return { data: result.data };
}
