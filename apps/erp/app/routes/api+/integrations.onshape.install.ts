import { requirePermissions } from "@carbon/auth/auth.server";
import { Onshape } from "@carbon/ee";
import { beginOnshapeAuthorization } from "@carbon/ee/onshape.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { path } from "~/utils/path";

async function authorize(request: Request) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });
  return beginOnshapeAuthorization(request, {
    integrationId: Onshape.id,
    userId,
    companyId
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const started = await authorize(request);

  // `error` is an integration-errors code; the client sends it to the
  // integrations page, which renders the copy.
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

/**
 * The integration drawer's Reconnect action: the same authorization as an
 * install, answered as a `redirectUrl` the action button follows. The consent
 * screen replaces the page, and the callback, finding no popup opener, lands
 * back on the integrations page. A failure goes there too, as the
 * `?integration=&error=` toast an install failure shows.
 */
export async function action({ request }: ActionFunctionArgs) {
  const started = await authorize(request);
  if (!started.ok) {
    return data({
      redirectUrl: `${path.to.integrations}?integration=${Onshape.id}&error=${started.reason}`
    });
  }
  return data(
    { redirectUrl: started.url },
    { headers: { "Set-Cookie": started.cookie } }
  );
}
