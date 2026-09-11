import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { consumeOAuthState } from "@carbon/auth/oauth-state.server";
import type { Json } from "@carbon/database";
import { Ramp, resolveIntegrationSecrets } from "@carbon/ee";
import { rampOnInstall } from "@carbon/ee/ramp/hooks.server";
import { exchangeRampOAuthCode } from "@carbon/ee/ramp.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { IntegrationErrorCode } from "~/modules/settings/integration-errors";
import { integrationErrorSearch } from "~/modules/settings/integration-errors";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { getIntegration } from "~/modules/settings/settings.service";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

// nodejs runtime: the code exchange uses the OAuth app's client secret.
export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "ramp", "oauth");

function connectionFailed(
  reason: IntegrationErrorCode<"ramp">,
  stateCookie: string
) {
  return redirect(
    `${getAppUrl()}${path.to.integrations}${integrationErrorSearch(
      "ramp",
      reason
    )}`,
    { headers: { "Set-Cookie": stateCookie } }
  );
}

function connectionSucceeded(stateCookie: string) {
  return redirect(`${getAppUrl()}${path.to.integrations}`, {
    headers: { "Set-Cookie": stateCookie }
  });
}

/**
 * Ramp "Connect to Ramp" OAuth callback. Ramp redirects here with `code` +
 * `state` after the user approves. We exchange the code for oauth2 tokens using
 * Carbon's registered Ramp OAuth app, store them (the vault holds the access +
 * refresh tokens via `upsertCompanyIntegration`), and run the standard install
 * converge (chart-of-accounts push, connection, webhook, initial sync). Account
 * mapping happens afterwards in the integration's Details drawer.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const state = url.searchParams.get("state") ?? "";
  const consumedState = await consumeOAuthState(request, state, {
    integrationId: Ramp.id,
    userId,
    companyId
  });

  if (!consumedState.valid) {
    logger.error("Invalid Ramp OAuth state", { companyId, userId });
    return connectionFailed("invalid-state", consumedState.cookie);
  }

  if (searchParams.error) {
    logger.error("Ramp authorization refused", {
      error: searchParams.error,
      errorDescription: searchParams.error_description
    });
    return connectionFailed("denied", consumedState.cookie);
  }

  const rampAuthResponse = oAuthCallbackSchema.safeParse(searchParams);
  if (!rampAuthResponse.success) {
    logger.error("Invalid Ramp auth response", {
      params: Object.keys(searchParams)
    });
    return connectionFailed("invalid-response", consumedState.cookie);
  }

  const { code } = rampAuthResponse.data;

  // The redirect_uri sent to Ramp's token endpoint MUST byte-for-byte match the
  // one used at authorize time. The authorize step builds it browser-side from
  // `window.location.origin` (IntegrationCard), so we must reproduce the SAME
  // public origin here — NOT `new URL(request.url).origin`, which behind the
  // portless dev proxy (and any TLS-terminating proxy) is the internal
  // `http://127.0.0.1:<port>` and produces an `invalid_grant` (DEVELOPER_7012)
  // mismatch. `getAppUrl()` is the canonical public origin in dev/preview/prod.
  const redirectUri = `${getAppUrl()}/api/integrations/ramp/oauth`;

  let credentials: Awaited<ReturnType<typeof exchangeRampOAuthCode>>;
  try {
    credentials = await exchangeRampOAuthCode(code, redirectUri);
  } catch (error) {
    logger.error("Ramp token exchange failed", { error, companyId });
    return connectionFailed("token-exchange", consumedState.cookie);
  }

  try {
    const existing = await getIntegration(client, Ramp.id, companyId);
    if (existing.error) throw existing.error;

    let metadata: { [key: string]: Json | undefined } = {};
    if (existing.data) {
      const resolved = await resolveIntegrationSecrets(
        getCarbonServiceRole(),
        companyId,
        Ramp.id,
        existing.data.metadata,
        existing.data.secretRef
      );
      if (
        !resolved ||
        typeof resolved !== "object" ||
        Array.isArray(resolved)
      ) {
        throw new Error("Invalid existing Ramp integration metadata");
      }
      metadata = resolved as { [key: string]: Json | undefined };
    }

    const storedCredentials: Json = {
      type: credentials.type,
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt,
      environment: credentials.environment
    };

    const created = await upsertCompanyIntegration(client, {
      id: Ramp.id,
      active: true,
      metadata: { ...metadata, credentials: storedCredentials },
      updatedBy: userId,
      companyId
    });

    if (!created?.data?.metadata) {
      logger.error("Failed to save Ramp integration", {
        error: created?.error,
        companyId
      });
      return connectionFailed("save-failed", consumedState.cookie);
    }
  } catch (error) {
    logger.error("Failed to save Ramp integration", { error, companyId });
    return connectionFailed("save-failed", consumedState.cookie);
  }

  try {
    await rampOnInstall(companyId);
  } catch (error) {
    logger.error("Ramp install convergence failed", { error, companyId });
    return connectionFailed("install-failed", consumedState.cookie);
  }

  return connectionSucceeded(consumedState.cookie);
}
