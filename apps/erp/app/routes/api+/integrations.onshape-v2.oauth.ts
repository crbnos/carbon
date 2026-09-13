import { requirePermissions } from "@carbon/auth/auth.server";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { completeOnshapeAuthorization } from "~/modules/settings/onshape-oauth.server";

export const config = {
  runtime: "nodejs"
};

/**
 * The panel integration's own OAuth callback. Register this URL alongside the
 * v1 one on the same Onshape application — the two integrations hold separate
 * grants so either can be uninstalled without disturbing the other.
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
