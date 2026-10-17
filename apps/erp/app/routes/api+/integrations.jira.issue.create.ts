// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyEmployees, getJiraClient } from "@carbon/ee/jira.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunction } from "react-router";
import { createJiraIssue } from "~/modules/shared/shared.server";

const jira = getJiraClient();

export async function action(args: ActionFunctionArgs) {
  const input = await validator(createJiraIssue.input).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.shared.createJiraIssue(input.data);
}

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
