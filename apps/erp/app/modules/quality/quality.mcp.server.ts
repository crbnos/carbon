import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commandError } from "~/services/mcp-command-error";
import {
  requireToolCompanyRecord,
  requireToolPermission
} from "~/services/mcp-guards.server";
import type { nonConformanceStatus } from "./quality.models";
import { transitionIssueStatus } from "./quality-transitions.server";

// Quality route commands published under the tool names of the bare service
// primitives they replace (a same-named export here SHADOWS the
// `quality.service.ts` one; the registry spreads this module last). Each
// wrapper re-applies the route's request gates and turns the command's result
// into `{ data, error }`; the transition lives in
// `quality-transitions.server.ts`, shared with the routes.
//
// `client` MUST stay named `client` and first — the dispatcher injects it by
// name. Server-only: never re-export from the module barrel.

/**
 * Change an issue's (NCR's) status as the issue header does: Closed runs the Complete action (posts dispositions); reopening an NCR that posted inventory is refused.
 *
 * Closed is refused while any disposition is pending or its quantities
 * disagree; on success it posts the disposition's inventory movements and
 * tracked-entity changes. Registered and In Progress clear the close date.
 * `id` is the issue's uuid.
 */
export async function updateIssueStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: { id: string; status: (typeof nonConformanceStatus)[number] }
) {
  await requireToolPermission(
    userId,
    companyId,
    "quality",
    "update",
    "change issue status"
  );
  await requireToolCompanyRecord(
    "nonConformance",
    companyId,
    { id: args.id },
    "Issue"
  );
  const result = await transitionIssueStatus(client, {
    id: args.id,
    companyId,
    userId,
    status: args.status
  });
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}
