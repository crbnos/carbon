// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { OnshapePanelMe } from "@carbon/ee";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * Who the panel's bearer token belongs to, and whether they may edit the
 * company's property map (the panel's Fields page). 401 when the token is
 * missing or dead.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, sessionUserId, email } =
    await requireOnshapePanelPermissions(request, {});

  // `requireOnshapePanelPermissions` cannot be probed a second time for a
  // yes/no, so the claims check is re-run directly.
  // Claims belong to the session user, matching what the Fields route enforces.
  const [company, claims] = await Promise.all([
    client.from("company").select("id, name").eq("id", companyId).maybeSingle(),
    getUserClaims(sessionUserId, companyId)
  ]);

  const me: OnshapePanelMe = {
    userId,
    email,
    company: company.data
      ? { id: company.data.id, name: company.data.name }
      : null,
    canEditFields: hasPermission(
      claims?.permissions,
      "settings",
      "update",
      companyId
    )
  };

  return data(me, { headers: { "Cache-Control": "no-store" } });
}
