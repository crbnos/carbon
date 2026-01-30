import { getCarbonServiceRole } from "@carbon/auth";
import {
  getCompanyEmployees,
  getLinearClient,
  linkActionToLinearIssue
} from "@carbon/ee/linear";
import { task } from "@trigger.dev/sdk";
import { z } from "zod";

const linear = getLinearClient()

// Schema for webhook payload - we only need the issue ID since we fetch full details from Linear
export const syncIssueFromLinearSchema = z.object({
  companyId: z.string(),
  event: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("Issue"),
      action: z.literal("update"),
      data: z.object({
        id: z.string(),
        assigneeId: z.string().optional(),
      }),
    }),
  ]),
});

export const syncIssueFromLinear = task({
  id: "sync-issue-from-linear",
  retry: {
    maxAttempts: 1,
  },
  maxDuration: 5 * 60,
  run: async (payload: z.infer<typeof syncIssueFromLinearSchema>) => {
    console.info(`🔰 Linear webhook received: ${payload}`);
    console.info(`📦 Payload:`, payload);

    const carbon = getCarbonServiceRole();

    const [company, integration] = await Promise.all([
      carbon.from("company").select("*").eq("id", payload.companyId).single(),
      carbon
        .from("companyIntegration")
        .select("*")
        .eq("companyId", payload.companyId)
        .eq("id", "linear")
        .single(),
    ]);

    if (company.error || !company.data) {
      throw new Error("Failed to fetch company from Carbon");
    }

    if (integration.error || !integration.data) {
      throw new Error("Failed to fetch integration from Carbon");
    }

    // Look up the action task via the mapping table
    const mapping = await carbon
      .from("externalIntegrationMapping")
      .select("entityId")
      .eq("entityType", "nonConformanceActionTask")
      .eq("integration", "linear")
      .eq("externalId", payload.event.data.id)
      .eq("companyId", payload.companyId)
      .maybeSingle();

    const action = mapping.data
      ? { data: { id: mapping.data.entityId } }
      : { data: null };

    if (!action.data) {
      return {
        success: false,
        message: `No linked action found for Linear issue ID ${payload.event.data.id}`,
      };
    }

    const fullIssue = await linear.getIssueById(
      payload.companyId,
      payload.event.data.id
    );

    if (!fullIssue) {
      return {
        success: false,
        message: `Failed to fetch issue ${payload.event.data.id} from Linear`,
      };
    }

    let assignee = null;

    if (payload.event.data.assigneeId) {
      const [linearUser] = await linear.getUsers(payload.companyId, {
        id: payload.event.data.assigneeId,
      });

      const employees = await getCompanyEmployees(carbon, payload.companyId, [
        linearUser?.email,
      ]);
      assignee = employees.length > 0 ? employees[0].userId : null;
    }

    const updated = await linkActionToLinearIssue(carbon, payload.companyId, {
      actionId: action.data.id,
      issue: fullIssue,
      assignee,
      syncNotes: true,
    });

    if (!updated || updated.error) {
      return {
        success: false,
        message: `Failed to update action for Linear issue ID ${payload.event.data.id}`,
      };
    }

    return {
      success: true,
      message: `Synced Linear issue ${payload.event.data.id}`,
    };
  },
});
