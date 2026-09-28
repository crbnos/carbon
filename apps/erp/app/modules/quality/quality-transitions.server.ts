import { ERP_URL } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { notifyIssueStatusChanged } from "@carbon/ee/notifications";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import {
  type CommandResult,
  commandFailed,
  commandOk
} from "~/services/command-result";
import { path } from "~/utils/path";
import type { nonConformanceStatus } from "./quality.models";
import { updateIssueStatus } from "./quality.service";
import { closeIssue } from "./quality-disposition.server";

// Server-only issue (NCR) status transitions, called by the issue status and
// close routes and published by `quality.mcp.server.ts` under the tool name
// of the bare status writer they replace.

const logger = getLogger("erp", "issue-transitions");

type IssueStatus = (typeof nonConformanceStatus)[number];

export const POSTED_NCR_REOPEN_MESSAGE =
  "This NCR posted inventory transactions and can't be reopened. Create a correcting entry instead.";

/**
 * Move an issue (NCR) to a new status as the issue header's buttons do:
 * - Closed is the Complete button (`x+/issue+/$id.close.tsx`): `closeIssue`
 *   refuses while any disposition is pending or quantities disagree, posts
 *   the disposition's inventory movements and tracked-entity changes, then
 *   sets Closed.
 * - Any other status (`x+/issue+/$id.status.tsx`) refuses to reopen a Closed
 *   NCR that posted inventory transactions, clears the close date and writes
 *   the status.
 * Either way the status-change notification is sent afterwards (best-effort).
 */
export async function transitionIssueStatus(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; userId: string; status: IssueStatus }
): Promise<CommandResult<{ id: string; status: IssueStatus }>> {
  const { id, companyId, userId, status } = args;
  const serviceRole = getCarbonServiceRole();

  if (status === "Closed") {
    const closed = await closeIssue(serviceRole, {
      nonConformanceId: id,
      companyId,
      userId
    });
    if (closed.error) {
      return commandFailed(
        closed.error.message ?? "Failed to close NCR",
        closed.error
      );
    }
  } else {
    // Reversing posted inventory must be an explicit compensating entry, not
    // a reopen. itemLedger SELECT needs inventory/accounting view, which a
    // quality user may lack, so this reads on the service role.
    const current = await serviceRole
      .from("nonConformance")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (current.data?.status === "Closed") {
      const posted = await serviceRole
        .from("itemLedger")
        .select("id")
        .eq("documentType", "Non-Conformance")
        .eq("documentId", id)
        .eq("companyId", companyId)
        .limit(1);
      if ((posted.data?.length ?? 0) > 0) {
        return commandFailed(POSTED_NCR_REOPEN_MESSAGE);
      }
    }

    const update = await updateIssueStatus(client, {
      id,
      status,
      assignee: undefined,
      closeDate: null,
      updatedBy: userId
    });
    if (update.error) {
      return commandFailed("Failed to update issue status", update.error);
    }
  }

  try {
    const integrations = await getCompanyIntegrations(client, companyId);
    await notifyIssueStatusChanged({ client }, integrations, {
      companyId,
      userId,
      carbonUrl: `${ERP_URL}${path.to.issue(id)}`,
      issue: { id, status, nonConformanceId: id, title: "" }
    });
  } catch (err) {
    logger.error("Failed to send issue status notifications", { error: err });
  }

  return commandOk({ id, status });
}
