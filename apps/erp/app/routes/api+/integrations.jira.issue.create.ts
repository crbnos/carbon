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
  getJiraClient,
  linkActionToJiraIssue,
  tiptapToAdf
} from "@carbon/ee/jira.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { requireChangeNoticeEditable } from "~/modules/items/items.server";
import { getActionTaskWithParent } from "~/services/action-task.server";

const logger = getLogger("erp", "integrations-jira-issue-create");

const jira = getJiraClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const formData = await request.formData();

    const actionId = formData.get("actionId") as string;
    const entityType = formData.get("entityType") as string | null;

    if (!isActionTaskEntityType(entityType)) {
      return data(
        { success: false, message: "Invalid entityType" },
        { status: 400 }
      );
    }

    const { companyId, client } = await requirePermissions(
      request,
      actionTaskPermissions(entityType)
    );

    const projectKey = formData.get("projectKey") as string;
    const issueTypeId = formData.get("issueTypeId") as string;
    const summary = formData.get("title") as string;
    const description = formData.get("description") as string;
    const assigneeId = formData.get("assignee") as string;

    if (!actionId || !projectKey || !issueTypeId || !summary) {
      return data(
        {
          success: false,
          message:
            "Missing required fields: actionId, projectKey, issueTypeId, title"
        },
        { status: 400 }
      );
    }

    const [carbonIssue, siteUrl] = await Promise.all([
      getActionTaskWithParent(client, entityType, actionId, companyId),
      jira.getSiteUrl(companyId)
    ]);

    if (entityType === "changeOrderActionTask") {
      const locked = carbonIssue.parentId
        ? await requireChangeNoticeEditable(client, {
            changeNoticeId: carbonIssue.parentId,
            companyId,
            scope: "workflow"
          })
        : { error: { message: "Could not find change notice" } };

      if (locked) {
        return data(
          { success: false, message: locked.error.message },
          { status: 400 }
        );
      }
    }

    // Use the task's notes as the Jira issue description, falling back to form description
    let adfDescription: any = undefined;
    const notes = carbonIssue.notes;
    if (notes && typeof notes === "object") {
      try {
        adfDescription = tiptapToAdf(notes as any);
      } catch (e) {
        logger.error("Failed to convert notes to ADF", { error: e });
      }
    }

    if (!adfDescription && description) {
      try {
        const tiptapDoc = JSON.parse(description);
        adfDescription = tiptapToAdf(tiptapDoc);
      } catch {
        adfDescription = {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description }]
            }
          ]
        };
      }
    }

    const issue = await jira.createIssue(companyId, {
      projectKey,
      issueTypeId,
      summary,
      description: adfDescription,
      assigneeId: assigneeId || undefined
    });

    if (!issue) {
      return data(
        { success: false, message: "Failed to create Jira issue" },
        { status: 500 }
      );
    }

    const linked = await linkActionToJiraIssue(client, companyId, {
      entityType,
      actionId,
      issue,
      siteUrl
    });

    if (!linked || linked.data?.length === 0) {
      return data(
        { success: false, message: "Failed to link issue" },
        { status: 500 }
      );
    }

    const parentId = actionTaskParentId(linked.data, entityType) ?? "";

    const url =
      getAppUrl() +
      `${actionTaskEntities[entityType].detailPath(parentId)}/details`;

    // Create a remote link in Jira pointing back to Carbon
    await jira.createRemoteLink(
      companyId,
      issue.id,
      url,
      `Linked Carbon Issue: ${carbonIssue.parentReadableId ?? ""}`
    );

    return { success: true, message: "Jira issue created" };
  } catch (error) {
    logger.error("Jira issue action error", { error: error });
    return data(
      { success: false, message: "Failed to create issue" },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const { companyId, client } = await requirePermissions(request, {});

  const url = new URL(request.url);

  const projectKey = url.searchParams.get("projectKey") as string;
  const projects = await jira.listProjects(companyId);

  if (projectKey) {
    const [issueTypes, members] = await Promise.all([
      jira.getIssueTypes(companyId, projectKey),
      jira.listProjectUsers(companyId, projectKey)
    ]);

    // Filter members to only those who are also Carbon employees
    const memberEmails = members
      .map((m) => m.emailAddress)
      .filter((e): e is string => !!e);

    const employees = await getCompanyEmployees(
      client,
      companyId,
      memberEmails
    );

    // Filter to members who are also Carbon employees
    const filteredMembers = members.filter((m) =>
      employees.some((e) => {
        if (!e.user?.email || !m.emailAddress) return false;
        return e.user.email.toLowerCase() === m.emailAddress.toLowerCase();
      })
    );

    return {
      projects,
      issueTypes,
      members: filteredMembers
    };
  }

  return { projects };
};
