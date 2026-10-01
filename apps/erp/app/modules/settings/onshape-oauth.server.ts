// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VERCEL_URL } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { consumeOAuthState } from "@carbon/auth/oauth-state.server";
import {
  ensureOnshapeReleaseWebhook,
  onshapeConnectionHasWriteScope
} from "@carbon/ee/hooks.server";
import {
  exchangeOnshapeAuthorizationCode,
  getConflictingOnshapeIntegration,
  ONSHAPE_OAUTH_SCOPES,
  type OnshapeIntegrationId
} from "@carbon/ee/onshape";
import { loadOnshapeOAuthConfig } from "@carbon/ee/onshape.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "react-router";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";
import type { IntegrationErrorCode } from "./integration-errors";
import { integrationErrorSearch } from "./integration-errors";
import { upsertCompanyIntegration } from "./settings.server";

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
 * The OAuth callback for both Onshape integrations — the public app
 * (`/api/integrations/onshape/oauth`) and a Government customer's private app
 * (`/api/integrations/onshape-government/oauth`). Only where the client comes
 * from differs, and `loadOnshapeOAuthConfig` owns that.
 *
 * Onshape reaches this by redirecting the user's browser, so a failure has to
 * render as something they can act on: send them back to the integrations
 * page, which turns the code into a toast. Only a code crosses the URL;
 * `integrationErrors` owns the copy.
 */
export async function completeOnshapeAuthorization({
  request,
  integrationId,
  userId,
  companyId
}: {
  request: Request;
  integrationId: OnshapeIntegrationId;
  userId: string;
  companyId: string;
}) {
  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  // The state must be the one issued to THIS browser for this user, company and
  // integration. Without the check anyone could send a victim a callback URL
  // carrying the attacker's own Onshape code, linking the victim's company to
  // the attacker's Onshape account. Single-use: consumed whether it matches or
  // not.
  const consumedState = await consumeOAuthState(
    request,
    url.searchParams.get("state") ?? "",
    { integrationId, userId, companyId }
  );

  // Both integrations declare the same codes, each with its own copy.
  const connectionFailed = (
    reason: IntegrationErrorCode<OnshapeIntegrationId>
  ) =>
    redirect(
      `${integrationsUrl(request)}${integrationErrorSearch<OnshapeIntegrationId>(integrationId, reason)}`,
      { headers: { "Set-Cookie": consumedState.cookie } }
    );

  if (!consumedState.valid) {
    logger.error("Invalid Onshape OAuth state", { integrationId, companyId });
    return connectionFailed("invalid-state");
  }

  // Onshape reports a refused authorization by redirecting here with `error`
  // (and usually `error_description`) in place of `code`. `invalid_scope`
  // means the OAuth application isn't granted a scope we asked for — in
  // practice `OAuth2Write` ("Application can write to your documents"), so the
  // UI can name the exact fix instead of echoing Onshape's wording.
  if (searchParams.error) {
    logger.error("Onshape authorization refused", {
      integrationId,
      error: searchParams.error,
      errorDescription: searchParams.error_description
    });
    return connectionFailed(
      searchParams.error === "invalid_scope" ? "write-permission" : "denied"
    );
  }

  const authResponse = oAuthCallbackSchema.safeParse(searchParams);
  if (!authResponse.success) {
    // Log the parameter names (never the values — `code` is a live credential).
    logger.error("Invalid Onshape auth response", {
      integrationId,
      params: Object.keys(searchParams)
    });
    return connectionFailed("invalid-response");
  }

  const serviceRole = getCarbonServiceRole();

  // A company holds one Onshape connection at a time; two would leave every
  // background job guessing which tenant to talk to.
  if (
    await getConflictingOnshapeIntegration(
      serviceRole,
      companyId,
      integrationId
    )
  ) {
    return connectionFailed("connection-conflict");
  }

  const oauth = await loadOnshapeOAuthConfig(companyId, integrationId);
  if (!oauth) return connectionFailed("not-configured");

  try {
    let tokenData: Awaited<ReturnType<typeof exchangeOnshapeAuthorizationCode>>;
    try {
      tokenData = await exchangeOnshapeAuthorizationCode(
        oauth,
        authResponse.data.code
      );
    } catch (error) {
      logger.error("Onshape token exchange failed", { integrationId, error });
      return connectionFailed("token-exchange");
    }

    if (!tokenData.access_token) {
      logger.error("Onshape token response had no access token", {
        integrationId
      });
      return connectionFailed("token-exchange");
    }

    const existing = await serviceRole
      .from("companyIntegration")
      .select("metadata")
      .eq("id", integrationId)
      .eq("companyId", companyId)
      .maybeSingle();
    const existingMetadata = (existing.data?.metadata ?? {}) as Record<
      string,
      unknown
    >;

    // The scope actually granted by this authorization. Onshape returns it on
    // the token response; fall back to what we requested. A token minted
    // without write can't export assets or manage the release webhook, and a
    // refresh can't widen it — so asset sync is switched off rather than left
    // on-but-broken.
    const scope = tokenData.scope ?? ONSHAPE_OAUTH_SCOPES.join(" ");
    const metadata: Record<string, unknown> = {
      ...existingMetadata,
      credentials: {
        type: "oauth2",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
      },
      scope,
      baseUrl: oauth.baseUrl
    };
    // Settings survive a reconnect (a Government app's client and tenant, the
    // asset-sync toggle), but the Onshape company is re-resolved from the new
    // token: it may belong to a different account or tenant.
    delete metadata.onshapeCompanyId;
    const canWrite = onshapeConnectionHasWriteScope(metadata);
    if (!canWrite) metadata.assetSyncEnabled = false;

    const saved = await upsertCompanyIntegration(serviceRole, {
      id: integrationId,
      active: true,
      // @ts-expect-error TS2322 - metadata is a JSON object
      metadata,
      updatedBy: userId,
      companyId
    });

    if (saved.error || !saved.data?.metadata) {
      logger.error("Failed to save Onshape integration", {
        integrationId,
        error: saved.error
      });
      return connectionFailed("save-failed");
    }

    // A Government connection is configured BEFORE it is authorized, so asset
    // sync may already be on: subscribe to releases now that there is a token.
    // Best-effort — the settings save retries it and reports a failure there.
    if (metadata.assetSyncEnabled === true) {
      const webhook = await ensureOnshapeReleaseWebhook(companyId, true);
      if (!webhook.ok) {
        logger.error("Onshape release webhook registration failed", {
          integrationId,
          error: webhook.error
        });
      }
    }

    return redirect(integrationsUrl(request), {
      headers: { "Set-Cookie": consumedState.cookie }
    });
  } catch (error) {
    logger.error("Onshape OAuth Error", { integrationId, error });
    return connectionFailed("unexpected");
  }
}
