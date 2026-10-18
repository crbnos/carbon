// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor, dataOrThrow } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    role: "employee"
  });
  const { client, companyId } = auth;
  const api = carbonFor(auth);

  const { groupId } = params;
  if (!groupId) {
    return { emails: [] };
  }

  // users_for_groups (SECURITY DEFINER) has no tenant check of its own —
  // verify the group belongs to the caller's company first.
  const group = await client
    .from("group")
    .select("id")
    .eq("id", groupId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (group.error) {
    return data(
      { emails: [], error: group.error },
      await flash(request, error(group.error, "Failed to load group emails"))
    );
  }

  if (!group.data) {
    return { emails: [] };
  }

  const emails = dataOrThrow(
    await api.users.getGroupEmails({ groupIds: [groupId] })
  );
  return { emails: [...new Set(emails)] };
}
