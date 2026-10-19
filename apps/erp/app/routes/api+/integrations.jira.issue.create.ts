// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  isSyncedEntityType,
  syncedEntities,
  syncedEntityPermissions
} from "@carbon/ee/issue-sync";
import { linkNewIssue } from "@carbon/ee/issue-sync.server";
import {
  getCompanyEmployees,
  getJiraClient,
  tiptapToAdf
} from "@carbon/ee/jira.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { requireChangeNoticeEditable } from "~/modules/items/items.server";
import {
  getActionTaskWithParent,
  projectElementLinkRefusal
} from "~/modules/shared/shared.server";

const logger = getLogger("erp", "integrations-jira-issue-create");

const jira = getJiraClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const formData = await request.formData();

    const actionId = formData.get("actionId") as string;
    const entityType = formData.get("entityType") as string | null;

    if (!isSyncedEntityType(entityType)) {
      return data(
        { success: false, message: "Invalid entityType" },
        { status: 400 }
      );
    }

    const { companyId, client } = await requirePermissions(
      request,
      syncedEntityPermissions(entityType)
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

    const carbonIssue = await getActionTaskWithParent(
      client,
      entityType,
      actionId,
      companyId
    );

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

    if (entityType === "projectElement") {
      const refusal = await projectElementLinkRefusal(
        client,
        actionId,
        companyId
      );
      if (refusal) {
        return data({ success: false, message: refusal }, { status: 400 });
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

    const linked = await linkNewIssue(getCarbonServiceRole(), {
      companyId,
      tracker: "jira",
      entityType,
      entityId: actionId,
      issueId: issue.id
    });

    if ("error" in linked) {
      return data({ success: false, message: linked.error }, { status: 500 });
    }

    const url =
      getAppUrl() +
      syncedEntities[entityType].detailPath(
        carbonIssue.parentId ?? "",
        actionId
      );

    // Create a remote link in Jira pointing back to Carbon
    await jira.createRemoteLink(
      companyId,
      issue.id,
      url,
      `Linked Carbon Issue: ${carbonIssue.parentReadableId ?? ""}`
    );

    // The first push runs under the per-company sync key.
    await trigger("issue-sync-push", {
      companyId,
      initial: true,
      records: [
        {
          table: entityType,
          recordId: actionId,
          operation: "UPDATE",
          old: null
        }
      ]
    });

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
