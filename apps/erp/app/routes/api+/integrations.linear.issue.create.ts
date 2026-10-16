// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyEmployees, getLinearClient } from "@carbon/ee/linear.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunction } from "react-router";
import { createLinearIssue } from "~/modules/shared/shared.server";

const linear = getLinearClient();

export async function action(args: ActionFunctionArgs) {
  const input = await validator(createLinearIssue.input).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.shared.createLinearIssue(input.data);
}

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
