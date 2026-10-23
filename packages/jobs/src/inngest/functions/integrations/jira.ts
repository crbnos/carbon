// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  applyIssue,
  ensureIssueSyncSubscriptions,
  unlinkDeletedIssue
} from "@carbon/ee/issue-sync.server";
import { syncIssueFromJiraSchema } from "../../../schemas.js";
import { inngest } from "../../client";
import { ISSUE_SYNC_CONCURRENCY } from "../events/issue-sync";

export { syncIssueFromJiraSchema };

const UPDATED = new Set(["jira:issue_updated", "issue_updated"]);
const DELETED = new Set(["jira:issue_deleted", "issue_deleted"]);

/**
 * Inbound Jira sync. The engine re-reads the issue, applies the fields that
 * changed since the last sync, and refuses the ones a lock protects.
 */
export const jiraSyncFunction = inngest.createFunction(
  {
    id: "sync-issue-from-jira",
    retries: 1,
    concurrency: ISSUE_SYNC_CONCURRENCY
  },
  { event: "carbon/jira-sync" },
  async ({ event, logger }) => {
    const payload = syncIssueFromJiraSchema.parse(event.data);
    const { companyId } = payload;
    const webhookEvent = payload.event.webhookEvent;

    logger.info("Jira webhook received", { companyId, webhookEvent });

    if (!UPDATED.has(webhookEvent) && !DELETED.has(webhookEvent)) {
      return {
        success: true,
        message: `Ignoring event type: ${webhookEvent}`
      };
    }

    const issueId = payload.event.issue?.id;
    if (!issueId) {
      return { success: false, message: "No issue data in webhook payload" };
    }

    const carbon = getCarbonServiceRole();

    const integration = await carbon
      .from("companyIntegration")
      .select("active")
      .eq("companyId", companyId)
      .eq("id", "jira")
      .maybeSingle();

    if (!integration.data?.active) {
      return { success: false, message: "Jira integration is not active" };
    }

    // A deleted issue breaks the link; the Carbon record stays.
    if (DELETED.has(webhookEvent)) {
      await unlinkDeletedIssue(carbon, { companyId, tracker: "jira", issueId });
      return { success: true, message: "Unlinked: the issue was deleted" };
    }

    await ensureIssueSyncSubscriptions(carbon, companyId, "jira");

    const result = await applyIssue(carbon, {
      companyId,
      tracker: "jira",
      issueId
    });

    return { success: !("failed" in result), issueId, ...result };
  }
);
