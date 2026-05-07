import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getCompanyEmployees,
  getLinearClient,
  linkActionToLinearIssue
} from "@carbon/ee/linear.server";
import { syncIssueFromLinearSchema } from "../../../schemas.js";
import { inngest } from "../../client";

export { syncIssueFromLinearSchema };

export const linearSyncFunction = inngest.createFunction(
  { id: "sync-issue-from-linear", retries: 1 },
  { event: "carbon/linear-sync" },
  async ({ event, step }) => {
    const linear = getLinearClient();
    const payload = syncIssueFromLinearSchema.parse(event.data);

    console.info(`Linear webhook received: ${payload}`);
    console.info(`Payload:`, payload);

    const carbon = getCarbonServiceRole();

    const [company, integration] = await Promise.all([
      carbon.from("company").select("*").eq("id", payload.companyId).single(),
      carbon
        .from("companyIntegration")
        .select("*")
        .eq("companyId", payload.companyId)
        .eq("id", "linear")
        .single()
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
        message: `No linked action found for Linear issue ID ${payload.event.data.id}`
      };
    }

    const fullIssue = await linear.getIssueById(
      payload.companyId,
      payload.event.data.id
    );

    if (!fullIssue) {
      return {
        success: false,
        message: `Failed to fetch issue ${payload.event.data.id} from Linear`
      };
    }

    let assignee: string | null = null;

    if (payload.event.data.assigneeId) {
      const [linearUser] = await linear.getUsers(payload.companyId, {
        id: payload.event.data.assigneeId
      });

      const employees = linearUser?.email
        ? await getCompanyEmployees(carbon, payload.companyId, [
            linearUser.email
          ])
        : [];
      assignee = employees.length > 0 ? employees[0]!.userId : null;
    }

    const updated = await linkActionToLinearIssue(carbon, payload.companyId, {
      actionId: action.data.id,
      issue: fullIssue,
      assignee,
      syncNotes: true
    });

    if (!updated || updated.error) {
      return {
        success: false,
        message: `Failed to update action for Linear issue ID ${payload.event.data.id}`
      };
    }

    return {
      success: true,
      message: `Synced Linear issue ${payload.event.data.id}`
    };
  }
);
