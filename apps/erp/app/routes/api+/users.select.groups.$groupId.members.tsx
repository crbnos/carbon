// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    role: "employee"
  });
  const api = carbonFor(auth);

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

  const result = await api.users.getUserSelectGroupMembers({ groupId });

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
