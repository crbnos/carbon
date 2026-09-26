import { ONSHAPE_CLIENT_ID, ONSHAPE_OAUTH_REDIRECT_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { issueOAuthState } from "@carbon/auth/oauth-state.server";
import { Onshape } from "@carbon/ee";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  if (!ONSHAPE_CLIENT_ID || !ONSHAPE_OAUTH_REDIRECT_URL) {
    return data({ error: "Onshape OAuth not configured" }, { status: 500 });
  }

  // Bound to this browser, user and company, and consumed by the callback —
  // otherwise anyone could hand a victim a callback URL carrying their own
  // Onshape code and link the victim's company to the attacker's account.
  const { state, cookie } = await issueOAuthState(
    { integrationId: Onshape.id, userId, companyId },
    request
  );

  const params = new URLSearchParams({
    client_id: ONSHAPE_CLIENT_ID,
    redirect_uri: ONSHAPE_OAUTH_REDIRECT_URL,
    response_type: "code",
    state
  });

  // Read for models/revisions/documents; Write to create translation (GLTF/PDF
  // export) jobs and manage the release webhook subscription. Both scopes must be
  // granted to the OAuth application in the Onshape dev portal, or Onshape refuses
  // the authorization and redirects back with `error` instead of `code`.
  //
  // Appended outside URLSearchParams so the delimiter is `%20`: RFC 6749 scope is
  // space-delimited, and URLSearchParams serializes a space as `+`, which only
  // means "space" under form-encoding rules a query string doesn't guarantee.
  const scope = ["OAuth2Read", "OAuth2Write"].join("%20");

  const url = `https://oauth.onshape.com/oauth/authorize?${params}&scope=${scope}`;

  return data({ url }, { headers: { "Set-Cookie": cookie } });
}
