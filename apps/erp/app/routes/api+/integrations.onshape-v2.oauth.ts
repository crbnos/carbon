// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { completeOnshapeAuthorization } from "~/modules/settings/settings.service";

export const config = {
  runtime: "nodejs"
};

/**
 * OAuth callback for the panel's own grant, kept apart from the sync
 * connection's so either can be uninstalled alone. Register it on the same
 * Onshape app.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  return completeOnshapeAuthorization({
    request,
    integrationId: ONSHAPE_V2_INTEGRATION_ID,
    userId,
    companyId
  });
}
