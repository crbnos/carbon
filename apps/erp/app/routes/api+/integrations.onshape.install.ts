import { ONSHAPE_CLIENT_ID, ONSHAPE_OAUTH_REDIRECT_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  if (!ONSHAPE_CLIENT_ID || !ONSHAPE_OAUTH_REDIRECT_URL) {
    return data({ error: "Onshape OAuth not configured" }, { status: 500 });
  }

  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: ONSHAPE_CLIENT_ID,
    redirect_uri: ONSHAPE_OAUTH_REDIRECT_URL,
    response_type: "code",
    // Read for models/revisions/documents; Write to create translation (STEP/PDF
    // export) jobs and manage the release webhook subscription.
    scope: "OAuth2Read OAuth2Write",
    state
  });

  const url = `https://oauth.onshape.com/oauth/authorize?${params}`;

  return { url };
}
