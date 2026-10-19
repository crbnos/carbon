// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isChangeNoticeLocked } from "@carbon/database/change-notice";
import { isActionTaskEntityType } from "@carbon/ee/action-task-entity";
import {
  getCompanyEmployees,
  getLinearClient,
  linkActionToLinearIssue,
  resolveInboundAssignee
} from "@carbon/ee/linear.server";
import { syncIssueFromLinearSchema } from "../../../schemas.js";
import { inngest } from "../../client";

export { syncIssueFromLinearSchema };

export const linearSyncFunction = inngest.createFunction(
  { id: "sync-issue-from-linear", retries: 1 },
  { event: "carbon/linear-sync" },
  async ({ event, step, logger }) => {
    const linear = getLinearClient();
    const payload = syncIssueFromLinearSchema.parse(event.data);

    logger.info("Linear webhook received", { payload });

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
      .select("entityId, entityType")
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

    const mappedEntityType = mapping.data!.entityType;

    if (!isActionTaskEntityType(mappedEntityType)) {
      logger.info("Ignoring Linear mapping for non-action-task entity", {
        entityType: mappedEntityType,
        externalId: payload.event.data.id
      });
      return {
        success: false,
        message: `Mapping for Linear issue ID ${payload.event.data.id} is not an action task (entityType: ${mappedEntityType})`
      };
    }

    if (mappedEntityType === "changeOrderActionTask") {
      const task = await carbon
        .from("changeOrderActionTask")
        .select("changeOrder(status)")
        .eq("id", action.data.id)
        .eq("companyId", payload.companyId)
        .maybeSingle();

      if (isChangeNoticeLocked(task.data?.changeOrder?.status)) {
        return {
          success: true,
          message: "Skipped: the change notice is closed"
        };
      }
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

    const email = fullIssue.assignee?.email ?? null;
    const employees = email
      ? await getCompanyEmployees(carbon, payload.companyId, [email])
      : [];
    const assignee = resolveInboundAssignee({
      issueHasAssignee: !!fullIssue.assignee,
      matchedUserId: employees[0]?.userId
    });

    const updated = await linkActionToLinearIssue(carbon, payload.companyId, {
      actionId: action.data.id,
      entityType: mappedEntityType,
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
