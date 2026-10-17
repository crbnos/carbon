// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  actionTaskPermissions,
  isActionTaskEntityType
} from "@carbon/ee/action-task-entity";
import { getLinearClient } from "@carbon/ee/linear.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunction } from "react-router";
import {
  linkLinearIssue,
  unlinkLinearIssue
} from "~/modules/shared/shared.server";

const linear = getLinearClient();

// POST links an existing Linear issue, DELETE unlinks it.
export async function action(args: ActionFunctionArgs) {
  if (args.request.method === "DELETE") {
    const input = await validator(unlinkLinearIssue.input).request(args, {
      method: "DELETE"
    });
    if ("invalid" in input) return input.invalid;
    const api = await carbon(args.request);
    return api.shared.unlinkLinearIssue(input.data);
  }
  const input = await validator(linkLinearIssue.input).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.shared.linkLinearIssue(input.data);
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

  const issues = await linear.listIssues(companyId, query);

  return { issues };
};
