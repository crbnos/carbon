// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import type { ActionFunctionArgs } from "react-router";
import { panelResponse } from "~/modules/settings/settings.service";

export const config = {
  runtime: "nodejs"
};

/** Apply a reviewed assembly plan: items, BOM lines per method, links, model export. */
export async function action({ request }: ActionFunctionArgs) {
  const api = carbonFor(
    await requireOnshapePanelPermissions(request, {
      create: "parts",
      update: "parts",
      delete: "parts"
    })
  );
  return panelResponse(
    await api.settings.pushOnshapeAssembly(
      await request.json().catch(() => null)
    )
  );
}
