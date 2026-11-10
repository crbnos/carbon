// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import { beginOnshapeAuthorization } from "@carbon/ee/onshape.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { isIntegrationInstallWithheld } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

async function authorize(request: Request) {
  const { client, userId, companyId, email } = await requirePermissions(
    request,
    {
      update: "settings"
    }
  );
  if (
    await isIntegrationInstallWithheld(client, {
      companyId,
      integrationId: ONSHAPE_V2_INTEGRATION_ID,
      email,
      userId
    })
  ) {
    return { ok: false as const, reason: "coming-soon" as const };
  }
  return beginOnshapeAuthorization(request, {
    integrationId: ONSHAPE_V2_INTEGRATION_ID,
    userId,
    companyId
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const started = await authorize(request);

  if (!started.ok) {
    return data(
      { error: started.reason },
      {
        status:
          started.reason === "not-configured"
            ? 500
            : started.reason === "coming-soon"
              ? 403
              : 409
      }
    );
  }

  return data(
    { url: started.url },
    { headers: { "Set-Cookie": started.cookie } }
  );
}

/** The drawer's Reconnect action, as in `integrations.onshape.install.ts`. */
export async function action({ request }: ActionFunctionArgs) {
  const started = await authorize(request);
  if (!started.ok) {
    return data({
      redirectUrl: `${path.to.integrations}?integration=${ONSHAPE_V2_INTEGRATION_ID}&error=${started.reason}`
    });
  }
  return data(
    { redirectUrl: started.url },
    { headers: { "Set-Cookie": started.cookie } }
  );
}
