// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { holdsGate } from "@carbon/database/access";
import type { OnshapePanelMe } from "@carbon/ee";
import { authorizePanel } from "@carbon/ee/onshape/panel-session.server";
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
  const { client, companyId, userId, email, permissions } =
    await authorizePanel(request);

  const [company, choices] = await Promise.all([
    client.from("company").select("id, name").eq("id", companyId).maybeSingle(),
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
    canEditFields: holdsGate(
      permissions,
      { "settings.integrations": "Edit" },
      companyId
    )
  };

  return data(me, { headers: { "Cache-Control": "no-store" } });
}
