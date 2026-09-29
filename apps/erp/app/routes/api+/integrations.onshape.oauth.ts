import { requirePermissions } from "@carbon/auth/auth.server";
import { Onshape } from "@carbon/ee";
import type { LoaderFunctionArgs } from "react-router";
import { completeOnshapeAuthorization } from "~/modules/settings/onshape-oauth.server";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  return completeOnshapeAuthorization({
    request,
    integrationId: Onshape.id,
    userId,
    companyId
  });
}
