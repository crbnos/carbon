// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { OnshapePanelMe } from "@carbon/ee";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getOnshapePanelCompanies } from "~/modules/settings/settings.service";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "onshape", "panel-me");

/** The panel user, their companies, and whether they may edit Fields. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, sessionUserId, email } =
    await requireOnshapePanelPermissions(request, {});

  // `requireOnshapePanelPermissions` throws on a denial, so the Fields
  // permission is read from the claims directly.
  const [company, claims, choices] = await Promise.all([
    client.from("company").select("id, name").eq("id", companyId).maybeSingle(),
    getUserClaims(sessionUserId, companyId),
    getOnshapePanelCompanies(client, userId, companyId)
  ]);
  // No list means no selector; the panel still works in the current company.
  if (choices.error) {
    logger.error("Could not list the panel's companies", {
      companyId,
      userId,
      error: choices.error
    });
  }

  const me: OnshapePanelMe = {
    userId,
    email,
    company: company.data
      ? { id: company.data.id, name: company.data.name }
      : null,
    companies: (choices.data ?? []).map(({ id, name }) => ({ id, name })),
    canEditFields: hasPermission(
      claims?.permissions,
      "settings",
      "update",
      companyId
    )
  };

  return data(me, { headers: { "Cache-Control": "no-store" } });
}
