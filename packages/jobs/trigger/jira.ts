import { getCarbonServiceRole } from "@carbon/auth";
import {
  getCompanyEmployees,
  getJiraClient,
  linkActionToJiraIssue
} from "@carbon/ee/jira";
import { task } from "@trigger.dev/sdk";
import { z } from "zod";

const jira = getJiraClient();

// Schema for Jira webhook payload
export const syncIssueFromJiraSchema = z.object({
  companyId: z.string(),
  event: z.object({
    timestamp: z.number().optional(),
    webhookEvent: z.string(),
    issue: z
      .object({
        id: z.string(),
        key: z.string(),
        fields: z.object({
          summary: z.string().optional(),
          description: z.any().nullable().optional(),
          status: z
            .object({
              name: z.string().optional(),
              statusCategory: z
                .object({
                  key: z.string()
                })
                .optional()
            })
            .optional(),
          assignee: z
            .object({
              accountId: z.string().optional(),
              emailAddress: z.string().optional(),
              displayName: z.string().optional()
            })
            .nullable()
            .optional(),
          duedate: z.string().nullable().optional()
        })
      })
      .optional(),
    changelog: z
      .object({
        items: z.array(
          z.object({
            field: z.string(),
            fieldtype: z.string().optional(),
            from: z.string().nullable().optional(),
            fromString: z.string().nullable().optional(),
            to: z.string().nullable().optional(),
            toString: z.string().nullable().optional()
          })
        )
      })
      .optional()
  })
});

export const syncIssueFromJira = task({
  id: "sync-issue-from-jira",
  retry: {
    maxAttempts: 1
  },
  maxDuration: 5 * 60,
  run: async (payload: z.infer<typeof syncIssueFromJiraSchema>) => {
    console.info(`🔰 Jira webhook received`);
    console.info(`📦 Event type: ${payload.event.webhookEvent}`);

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
      .select("entityId")
      .eq("entityType", "nonConformanceActionTask")
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

    // Resolve assignee if present
    let assignee: string | null = null;

    if (fullIssue.fields.assignee?.emailAddress) {
      const employees = await getCompanyEmployees(carbon, payload.companyId, [
        fullIssue.fields.assignee.emailAddress
      ]);
      assignee = employees.length > 0 ? employees[0].userId : null;
    }

    // Update the linked action task
    const updated = await linkActionToJiraIssue(carbon, payload.companyId, {
      actionId,
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
});
