import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getCompanyEmployees,
  getJiraClient,
  linkActionToJiraIssue,
  tiptapToAdf
} from "@carbon/ee/jira";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { getIssueAction } from "~/modules/quality/quality.service";

const jira = getJiraClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const formData = await request.formData();

    const { companyId, client } = await requirePermissions(request, {});

    const actionId = formData.get("actionId") as string;
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

    // Convert description to ADF format if provided
    let adfDescription: any = undefined;
    if (description) {
      // If the description is JSON (Tiptap), convert it to ADF
      try {
        const tiptapDoc = JSON.parse(description);
        adfDescription = tiptapToAdf(tiptapDoc);
      } catch {
        // If not JSON, create a simple ADF document with the text
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

    const [carbonIssue, siteUrl] = await Promise.all([
      getIssueAction(client, actionId),
      jira.getSiteUrl(companyId)
    ]);

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

    const nonConformanceId = linked.data?.[0].nonConformanceId;

    const url = getAppUrl() + `/x/issue/${nonConformanceId}/details`;

    // Create a remote link in Jira pointing back to Carbon
    await jira.createRemoteLink(
      companyId,
      issue.id,
      url,
      `Linked Carbon Issue: ${carbonIssue.data?.nonConformance?.nonConformanceId ?? ""}`
    );

    return { success: true, message: "Jira issue created" };
  } catch (error) {
    console.error("Jira issue action error:", error);
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
