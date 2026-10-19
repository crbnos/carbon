// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isChangeNoticeLocked } from "@carbon/database/change-notice";
import { isActionTaskEntityType } from "@carbon/ee/action-task-entity";
import {
  getCompanyEmployees,
  getJiraClient,
  linkActionToJiraIssue,
  resolveInboundAssignee
} from "@carbon/ee/jira.server";
import { syncIssueFromJiraSchema } from "../../../schemas.js";
import { inngest } from "../../client";

export { syncIssueFromJiraSchema };

export const jiraSyncFunction = inngest.createFunction(
  { id: "sync-issue-from-jira", retries: 1 },
  { event: "carbon/jira-sync" },
  async ({ event, step, logger }) => {
    const jira = getJiraClient();
    const payload = syncIssueFromJiraSchema.parse(event.data);

    logger.info("Jira webhook received", {
      eventType: payload.event.webhookEvent
    });

    // Only handle issue_updated events
    if (
      payload.event.webhookEvent !== "jira:issue_updated" &&
      payload.event.webhookEvent !== "issue_updated"
    ) {
      return {
        success: true,
        message: `Ignoring event type: ${payload.event.webhookEvent}`
      };
    }

    if (!payload.event.issue) {
      return {
        success: false,
        message: "No issue data in webhook payload"
      };
    }

    const carbon = getCarbonServiceRole();

    const [company, integration] = await Promise.all([
      carbon.from("company").select("*").eq("id", payload.companyId).single(),
      carbon
        .from("companyIntegration")
        .select("*")
        .eq("companyId", payload.companyId)
        .eq("id", "jira")
        .single()
    ]);

    if (company.error || !company.data) {
      throw new Error("Failed to fetch company from Carbon");
    }

    if (integration.error || !integration.data) {
      throw new Error("Failed to fetch integration from Carbon");
    }

    const issueId = payload.event.issue.id;

    // Look up the action task via the mapping table
    const mapping = await carbon
      .from("externalIntegrationMapping")
      .select("entityId, entityType")
      .eq("integration", "jira")
      .eq("externalId", issueId)
      .eq("companyId", payload.companyId)
      .maybeSingle();

    if (!mapping.data) {
      return {
        success: false,
        message: `No linked action found for Jira issue ID ${issueId}`
      };
    }

    const actionId = mapping.data.entityId;
    const entityType = mapping.data.entityType;

    if (!isActionTaskEntityType(entityType)) {
      logger.info("Ignoring Jira mapping for non-action-task entity", {
        entityType,
        externalId: issueId
      });
      return {
        success: false,
        message: `Mapping for Jira issue ID ${issueId} is not an action task (entityType: ${entityType})`
      };
    }

    if (entityType === "changeOrderActionTask") {
      const task = await carbon
        .from("changeOrderActionTask")
        .select("changeOrder(status)")
        .eq("id", actionId)
        .eq("companyId", payload.companyId)
        .maybeSingle();

      if (isChangeNoticeLocked(task.data?.changeOrder?.status)) {
        return {
          success: true,
          message: "Skipped: the change notice is closed"
        };
      }
    }

    // Fetch the full issue from Jira
    const fullIssue = await jira.getIssue(payload.companyId, issueId);

    if (!fullIssue) {
      return {
        success: false,
        message: `Failed to fetch issue ${issueId} from Jira`
      };
    }

    // Get the site URL for the mapping
    const siteUrl = await jira.getSiteUrl(payload.companyId);

    // Jira can hide an assignee's email; an unmatched assignee leaves
    // the Carbon assignee as it is.
    const email = fullIssue.fields.assignee?.emailAddress ?? null;
    const employees = email
      ? await getCompanyEmployees(carbon, payload.companyId, [email])
      : [];
    const assignee = resolveInboundAssignee({
      issueHasAssignee: !!fullIssue.fields.assignee,
      matchedUserId: employees[0]?.userId
    });

    // Update the linked action task
    const updated = await linkActionToJiraIssue(carbon, payload.companyId, {
      actionId,
      entityType,
      issue: fullIssue,
      siteUrl,
      assignee,
      syncNotes: true
    });

    if (!updated || updated.error) {
      return {
        success: false,
        message: `Failed to update action for Jira issue ID ${issueId}`
      };
    }

    return {
      success: true,
      message: `Synced Jira issue ${fullIssue.key}`
    };
  }
);
