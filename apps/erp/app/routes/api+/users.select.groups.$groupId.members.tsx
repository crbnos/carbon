// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getUserSelectGroupMembers } from "~/modules/users";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { groupId } = params;
  if (!groupId) {
    return data(
      { groups: [], users: [] },
      await flash(
        request,
        error(new Error("groupId is required"), "Group id is required")
      )
    );
  }

  const result = await getUserSelectGroupMembers(client, companyId, groupId);

  if (result.error) {
    return data(
      { groups: [], users: [], error: result.error },
      await flash(request, error(result.error, "Failed to load group members"))
    );
  }

  return {
    groups: result.data?.groups ?? [],
    users: result.data?.users ?? []
  };
}
