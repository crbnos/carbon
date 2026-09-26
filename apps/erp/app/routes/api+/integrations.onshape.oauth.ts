import {
  ONSHAPE_CLIENT_ID,
  ONSHAPE_CLIENT_SECRET,
  ONSHAPE_OAUTH_REDIRECT_URL,
  VERCEL_URL
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { consumeOAuthState } from "@carbon/auth/oauth-state.server";
import { Onshape } from "@carbon/ee";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { IntegrationErrorCode } from "~/modules/settings/integration-errors";
import { integrationErrorSearch } from "~/modules/settings/integration-errors";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "onshape", "oauth");

/** Absolute integrations-page URL on this request's origin. */
function integrationsUrl(request: Request) {
  const requestUrl = new URL(request.url);

  if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
    requestUrl.protocol = "http";
  }

  return `${requestUrl.origin}${path.to.integrations}`;
}

/**
 * Onshape reaches this loader by redirecting the user's browser, so a failure has
 * to render as something they can act on. Returning `data({ error })` produced a
 * bare `{"error":"…"}` JSON document — dead end, no navigation, no next step. Send
 * them back to the integrations page, which turns the code into a toast. Only a
 * code crosses the URL; `integrationErrors` owns the copy.
 */
function connectionFailed(
  request: Request,
  reason: IntegrationErrorCode<"onshape">,
  stateCookie: string
) {
  return redirect(
    `${integrationsUrl(request)}${integrationErrorSearch("onshape", reason)}`,
    { headers: { "Set-Cookie": stateCookie } }
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  // The state must be the one install.ts issued to THIS browser for this user
  // and company. Without the check anyone could send a victim a callback URL
  // carrying the attacker's own Onshape code, linking the victim's company to
  // the attacker's Onshape account. Single-use: consumed whether it matches or not.
  const consumedState = await consumeOAuthState(
    request,
    url.searchParams.get("state") ?? "",
    { integrationId: Onshape.id, userId, companyId }
  );

  if (!consumedState.valid) {
    logger.error("Invalid Onshape OAuth state", { companyId, userId });
    return connectionFailed(request, "invalid-state", consumedState.cookie);
  }

  // Onshape reports a refused authorization by redirecting here with `error` (and
  // usually `error_description`) in place of `code` — e.g. `invalid_scope` when the
  // OAuth application in the Onshape dev portal isn't granted a scope install.ts
  // asked for. Parsing for `code` first collapsed every one of those into an opaque
  // "Invalid Onshape auth response", so surface it instead.
  if (searchParams.error) {
    logger.error("Onshape authorization refused", {
      error: searchParams.error,
      errorDescription: searchParams.error_description
    });

    // `invalid_scope` means the OAuth application isn't granted a scope we asked
    // for. In practice that's `OAuth2Write` — labelled "Application can write to
    // your documents" in the Onshape dev portal — so the UI can name the exact fix
    // instead of echoing Onshape's wording, which never says which scope is missing.
    return connectionFailed(
      request,
      searchParams.error === "invalid_scope" ? "write-permission" : "denied",
      consumedState.cookie
    );
  }

  const authResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!authResponse.success) {
    // Log the parameter names (never the values — `code` is a live credential)
    // so a malformed callback is diagnosable from the logs.
    logger.error("Invalid Onshape auth response", {
      params: Object.keys(searchParams)
    });
    return connectionFailed(request, "invalid-response", consumedState.cookie);
  }

  const { data: params } = authResponse;

  if (
    !ONSHAPE_CLIENT_ID ||
    !ONSHAPE_CLIENT_SECRET ||
    !ONSHAPE_OAUTH_REDIRECT_URL
  ) {
    return connectionFailed(request, "not-configured", consumedState.cookie);
  }

  try {
    const tokenResponse = await fetch("https://oauth.onshape.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        client_id: ONSHAPE_CLIENT_ID,
        client_secret: ONSHAPE_CLIENT_SECRET,
        redirect_uri: ONSHAPE_OAUTH_REDIRECT_URL
      })
    });

    if (!tokenResponse.ok) {
      logger.error("Onshape token exchange failed", {
        status: tokenResponse.status,
        body: await tokenResponse.text()
      });
      return connectionFailed(request, "token-exchange", consumedState.cookie);
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      logger.error("Onshape token response had no access token");
      return connectionFailed(request, "token-exchange", consumedState.cookie);
    }

    const serviceRole = getCarbonServiceRole();
    const createdIntegration = await upsertCompanyIntegration(serviceRole, {
      id: Onshape.id,
      active: true,
      metadata: {
        credentials: {
          type: "oauth2",
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
        },
        // The scope actually granted by this authorization. Onshape returns it on
        // the token response; fall back to what we requested (install.ts always
        // asks for read+write). Used to tell an already-connected user they must
        // reconnect before enabling asset sync — a token minted before write was
        // requested is read-only, and a refresh can't widen it. Legacy installs
        // predate this field (no `scope`), which reads as read-only → prompt.
        scope: tokenData.scope ?? "OAuth2Read OAuth2Write",
        baseUrl: "https://cad.onshape.com"
      },
      updatedBy: userId,
      companyId: companyId
    });

    if (createdIntegration?.data?.metadata) {
      // The release webhook is registered when the user enables asset sync (see
      // the integration settings save + ensureOnshapeReleaseWebhook), not on
      // connect — asset sync is off by default, so there's nothing to subscribe
      // to yet at this point.
      return redirect(integrationsUrl(request), {
        headers: { "Set-Cookie": consumedState.cookie }
      });
    } else {
      logger.error("Failed to save Onshape integration", {
        createdIntegration
      });
      return connectionFailed(request, "save-failed", consumedState.cookie);
    }
  } catch (err) {
    logger.error("Onshape OAuth Error", { error: err });
    return connectionFailed(request, "unexpected", consumedState.cookie);
  }
}
