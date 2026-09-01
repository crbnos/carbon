import { VERCEL_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  createConnection,
  exchangeAuthorizationCode
} from "@carbon/ee/integrations/connections";
import type { AllowlistEntry } from "@carbon/jobs/integrations";
import {
  accountLabelFromBody,
  connectionMetadataFrom,
  getPieceOAuth2Auth,
  PIECE_ALLOWLIST,
  resolveOAuthApp
} from "@carbon/jobs/integrations";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { verifyConnectionState } from "~/modules/settings/connection-state.server";
import type { IntegrationErrorCode } from "~/modules/settings/integration-errors";
import { integrationErrorSearch } from "~/modules/settings/integration-errors";
import {
  invalidateIntegrationHealthCache,
  markIntegrationInstalled
} from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations", "connections");

function integrationsUrl(request: Request) {
  const requestUrl = new URL(request.url);
  if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
    requestUrl.protocol = "http";
  }
  return `${requestUrl.origin}${path.to.integrations}`;
}

/** The vendor redirects the browser here, so a failure must render as something
 * actionable. Only a code crosses the URL; `integrationErrors` owns the copy. */
function connectionFailed(
  request: Request,
  reason: IntegrationErrorCode<"connection">
) {
  return redirect(
    `${integrationsUrl(request)}${integrationErrorSearch("connection", reason)}`
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  if (searchParams.error) {
    logger.error("Integration authorization refused", {
      error: searchParams.error
    });
    return connectionFailed(request, "denied");
  }

  const parsed = oAuthCallbackSchema.safeParse(searchParams);
  if (!parsed.success) {
    // Parameter NAMES only — `code` is a live credential.
    logger.error("Invalid integration auth response", {
      params: Object.keys(searchParams)
    });
    return connectionFailed(request, "invalid-response");
  }

  // The signature is what stops a token being planted into another company's
  // connection; the session check on top stops a replay into a company the
  // signer no longer sits in.
  const state = verifyConnectionState(parsed.data.state);
  if (state === null || state.companyId !== companyId) {
    logger.error("Integration callback state rejected", {
      matched: state?.companyId === companyId
    });
    return connectionFailed(request, "invalid-state");
  }

  const entry = PIECE_ALLOWLIST[state.pieceName];
  if (entry === undefined) {
    return connectionFailed(request, "invalid-state");
  }

  let app: ReturnType<typeof resolveOAuthApp>;
  try {
    app = resolveOAuthApp(state.pieceName);
  } catch {
    return connectionFailed(request, "not-configured");
  }

  try {
    const auth = await getPieceOAuth2Auth(state.pieceName);
    const tokens = await exchangeAuthorizationCode(
      {
        tokenUrl: auth.tokenUrl,
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        redirectUri: app.redirectUrl
      },
      parsed.data.code
    );

    await createConnection(getCarbonServiceRole(), {
      companyId,
      pieceName: state.pieceName,
      name: state.name,
      authType: "OAUTH2",
      accountLabel:
        accountLabelFromBody(entry, tokens.body) ??
        (await accountLabelFor(entry, tokens.accessToken)),
      // Workspace facts the row asked for (Slack: team, bot user, webhook channel).
      metadata: connectionMetadataFrom(entry, tokens.body),
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      },
      expiresAt: tokens.expiresAt,
      createdBy: state.userId
    });

    // The piece is an ordinary integration card, so a connected account is what
    // "installed" means for it. Without this row the grid would keep offering
    // Install for an account that is already connected. Never overwrite an
    // existing row — it may hold settings that are not this callback's to touch.
    const installed = await markIntegrationInstalled(client, {
      id: state.pieceName,
      companyId,
      updatedBy: userId
    });
    if (installed.error) throw installed.error;
    await invalidateIntegrationHealthCache(state.pieceName, companyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("integrationConnection_name_unique")) {
      return connectionFailed(request, "duplicate-name");
    }
    if (message.includes("rejected") || message.includes("access token")) {
      logger.error(`Integration token exchange failed: ${message}`);
      return connectionFailed(request, "token-exchange");
    }
    logger.error(
      `Integration connection save failed: name=${err instanceof Error ? err.name : typeof err} detail=${message.slice(0, 400)}`
    );
    return connectionFailed(request, "save-failed");
  }

  return redirect(integrationsUrl(request));
}

/** Which account was connected, so two connections are tellable apart in the UI.
 * Best-effort: a failure here must not lose a connection that already authorized. */
async function accountLabelFor(
  entry: AllowlistEntry,
  accessToken: string
): Promise<string | null> {
  // A vendor with no such endpoint shows the connection's own name instead; one
  // that puts the label in the token response was already read by the caller.
  const label = entry.accountLabel;
  if (label === undefined || !("url" in label)) return null;
  try {
    const response = await fetch(label.url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const value = body[label.field];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
