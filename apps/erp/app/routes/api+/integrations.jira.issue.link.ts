// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  actionTaskPermissions,
  isActionTaskEntityType
} from "@carbon/ee/action-task-entity";
import { getJiraClient } from "@carbon/ee/jira.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunction } from "react-router";
import { linkJiraIssue, unlinkJiraIssue } from "~/modules/shared/shared.server";

const jira = getJiraClient();

// POST links an existing Jira issue, DELETE unlinks it.
export async function action(args: ActionFunctionArgs) {
  if (args.request.method === "DELETE") {
    const input = await validator(unlinkJiraIssue.input).request(args, {
      method: "DELETE"
    });
    if ("invalid" in input) return input.invalid;
    const api = await carbon(args.request);
    return api.shared.unlinkJiraIssue(input.data);
  }
  const input = await validator(linkJiraIssue.input).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.shared.linkJiraIssue(input.data);
}

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);

  const entityType = url.searchParams.get("entityType");

  if (!isActionTaskEntityType(entityType)) {
    return { issues: [] };
  }

  const { companyId } = await requirePermissions(
    request,
    actionTaskPermissions(entityType)
  );

  const query = url.searchParams.get("search") as string;

  if (!query || query.trim().length === 0) {
    return { issues: [] };
  }

  const issues = await jira.searchIssues(companyId, query);

  return { issues };
};
