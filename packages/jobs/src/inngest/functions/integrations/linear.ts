// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  applyIssue,
  ensureIssueSyncSubscriptions,
  unlinkDeletedIssue
} from "@carbon/ee/issue-sync.server";
import { syncIssueFromLinearSchema } from "../../../schemas.js";
import { inngest } from "../../client";
import { ISSUE_SYNC_CONCURRENCY } from "../events/issue-sync";

export { syncIssueFromLinearSchema };

/**
 * Inbound Linear sync. The webhook carries only the issue id; the engine
 * re-reads the issue, applies the fields that changed since the last sync,
 * and refuses the ones a lock protects.
 */
export const linearSyncFunction = inngest.createFunction(
  {
    id: "sync-issue-from-linear",
    retries: 1,
    concurrency: ISSUE_SYNC_CONCURRENCY
  },
  { event: "carbon/linear-sync" },
  async ({ event, logger }) => {
    const payload = syncIssueFromLinearSchema.parse(event.data);
    const { companyId } = payload;
    const issueId = payload.event.data.id;

    logger.info("Linear webhook received", { payload });

    const carbon = getCarbonServiceRole();

    const integration = await carbon
      .from("companyIntegration")
      .select("active")
      .eq("companyId", companyId)
      .eq("id", "linear")
      .maybeSingle();

    if (!integration.data?.active) {
      return { success: false, message: "Linear integration is not active" };
    }

    // A deleted issue breaks the link; the Carbon record stays.
    if (payload.event.action === "remove") {
      await unlinkDeletedIssue(carbon, {
        companyId,
        tracker: "linear",
        issueId
      });
      return { success: true, message: "Unlinked: the issue was deleted" };
    }

    await ensureIssueSyncSubscriptions(carbon, companyId, "linear");

    const result = await applyIssue(carbon, {
      companyId,
      tracker: "linear",
      issueId
    });

    return { success: !("failed" in result), issueId, ...result };
  }
);
