// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs a published service function (`defineServiceFn`) for an API, MCP or
// workflow caller: the same function, with the same checks, the route calls.

import { permissionsFromClaims } from "@carbon/api/permissions";
import type {
  ErrorCategory,
  ServiceContext,
  ServiceFn
} from "@carbon/api/service-fn.server";
import { isPaged } from "@carbon/api/service-tools.server";
import { ORPCError } from "@orpc/server";
import type { z } from "zod";
import { contextFor } from "~/modules/service-context.server";
import type { AuthedContext } from "./base.server";
import { scopedToCompany } from "./company-scope.server";
import { COMPANY_TABLES, type DispatchResult } from "./operations.server";

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
export async function callServiceFn<I extends z.ZodType>(
  fn: ServiceFn<I, unknown>,
  context: AuthedContext,
  input: z.input<I>
): Promise<DispatchResult> {
  const result = await fn(contextFromAuthed(context), input);
  if (result.error) {
    const { category, message, status } = result.error;
    throw new ORPCError(CODES[category], {
      status,
      message,
      data: { category }
    });
  }
  if (isPaged(result.data)) {
    // A `paged` result: the rows go out as the list, the total beside them.
    const { rows, count } = result.data;
    return { data: rows, list: true, ...(count !== null ? { count } : {}) };
  }
  return { data: result.data, list: Array.isArray(result.data) };
}
