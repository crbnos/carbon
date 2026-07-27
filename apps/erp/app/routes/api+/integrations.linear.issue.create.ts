import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  actionTaskEntities,
  actionTaskParentId,
  actionTaskPermissions,
  isActionTaskEntityType
} from "@carbon/ee/action-task-entity";
import {
  getCompanyEmployees,
  getLinearClient,
  linkActionToLinearIssue
} from "@carbon/ee/linear.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { getActionTaskWithParent } from "~/services/action-task.server";

const logger = getLogger("erp", "integrations-linear-issue-create");

const linear = getLinearClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const data = await request.formData();

    const actionId = data.get("actionId") as string;
    const entityType = data.get("entityType") as string | null;

    if (!isActionTaskEntityType(entityType)) {
      return { success: false, message: "Invalid entityType" };
    }

    const { companyId, client } = await requirePermissions(
      request,
      actionTaskPermissions(entityType)
    );

    const teamId = data.get("teamId") as string;
    const title = data.get("title") as string;
    const description = data.get("description") as string;
    const assigneeId = data.get("assignee") as string;

    const [carbonIssue, issue] = await Promise.all([
      getActionTaskWithParent(client, entityType, actionId, companyId),
      linear.createIssue(companyId, {
        teamId,
        title,
        description: description || undefined,
        assigneeId: assigneeId || null
      })
    ]);

    if (!issue) {
      return { success: false, message: "Issue not found" };
    }

    const linked = await linkActionToLinearIssue(client, companyId, {
      entityType,
      actionId,
      issue: issue
    });

    if (!linked || linked.data?.length === 0) {
      return { success: false, message: "Failed to link issue" };
    }

    const parentId = actionTaskParentId(linked.data, entityType) ?? "";

    const url =
      getAppUrl() +
      `${actionTaskEntities[entityType].detailPath(parentId)}/details`;

    await linear.createAttachmentLink(companyId, {
      issueId: issue.id,
      url,
      title: `Linked Carbon Issue: ${carbonIssue.parentId ?? ""}`
    });

    return new Response("Linear issue created");
  } catch (error) {
    logger.error("Linear issue action error", { error: error });
    return data(
      { success: false, message: "Failed to create issue" },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const { companyId, client } = await requirePermissions(request, {});

  const url = new URL(request.url);

  const teamId = url.searchParams.get("teamId") as string;
  const teams = await linear.listTeams(companyId);

  if (teamId) {
    const members = teamId
      ? await linear.listTeamMembers(companyId, teamId)
      : [];
    const employees = await getCompanyEmployees(
      client,
      companyId,
      members.map((m) => m.email)
    );

    // I am sure we can improve this filtering step
    return {
      teams,
      members: members.filter((m) =>
        employees.some((v) => {
          if (!v.user?.email || !m.email) {
            return false;
          }
          return v.user.email.toLowerCase() === m.email.toLowerCase();
        })
      )
    };
  }

  return { teams };
};
