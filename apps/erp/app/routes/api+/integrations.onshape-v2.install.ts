import { requirePermissions } from "@carbon/auth/auth.server";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import { beginOnshapeAuthorization } from "@carbon/ee/onshape.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const started = await beginOnshapeAuthorization(request, {
    integrationId: ONSHAPE_V2_INTEGRATION_ID,
    userId,
    companyId
  });

  // `error` is an integration-errors code; the client reports it.
  if (!started.ok) {
    return data(
      { error: started.reason },
      { status: started.reason === "not-configured" ? 500 : 409 }
    );
  }

  return data(
    { url: started.url },
    { headers: { "Set-Cookie": started.cookie } }
  );
}
