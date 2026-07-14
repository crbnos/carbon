import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getCompanyEmployees,
  getLinearClient,
  linkActionToLinearIssue
} from "@carbon/ee/linear.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { getIssueAction } from "~/modules/quality/quality.service";

const logger = getLogger("erp", "integrations-linear-issue-create");

const linear = getLinearClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const data = await request.formData();

    const { companyId, client } = await requirePermissions(request, {});

    const actionId = data.get("actionId") as string;
    const teamId = data.get("teamId") as string;
    const title = data.get("title") as string;
    const description = data.get("description") as string;
    const assigneeId = data.get("assignee") as string;

    const [carbonIssue, issue] = await Promise.all([
      getIssueAction(client, actionId),
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
      actionId,
      issue: issue
    });

    if (!linked || linked.data?.length === 0) {
      return { success: false, message: "Failed to link issue" };
    }

    const nonConformanceId = linked.data?.[0].nonConformanceId;

    const url = getAppUrl() + `/x/issue/${nonConformanceId}/details`;

    await linear.createAttachmentLink(companyId, {
      issueId: issue.id,
      url,
      title: `Linked Carbon Issue: ${carbonIssue.data?.nonConformanceId ?? ""}`
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
