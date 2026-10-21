// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { consumeOAuthStateByValue } from "@carbon/auth/oauth-state.server";
import {
  ConnectionAccountMismatchError,
  ConnectionNameTakenError,
  ConnectionWorkspaceTakenError,
  createConnection,
  exchangeAuthorizationCode,
  TOKEN_REQUEST_TIMEOUT_MS
} from "@carbon/ee/integrations/connections";
import type { AllowlistEntry } from "@carbon/jobs/integrations";
import {
  accountLabelFromBody,
  allowlistEntry,
  connectionMetadataFrom,
  getPieceOAuth2Auth,
  resolveOAuthApp
} from "@carbon/jobs/integrations";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import type { IntegrationErrorCode } from "~/modules/settings/integration-errors";
import { integrationErrorSearch } from "~/modules/settings/integration-errors";
import {
  invalidateIntegrationHealthCache,
  markIntegrationInstalled,
  oauthPopupResponse,
  withCookie
} from "~/modules/settings/settings.service";
import { oAuthCallbackSchema } from "~/modules/shared/shared.models";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations", "connections");

/**
 * The consent screen runs in a popup the integrations page opened, so the answer
 * is posted back to that page (which refreshes, or shows the error) and the popup
 * closes. With no opener it lands on the integrations page like a redirect. Only a
 * code crosses; `integrationErrors` owns the copy. Every reply carries the state
 * cookie, which consuming the state rewrote.
 */
function connectionReply(
  integration: string,
  cookie: string,
  reason?: IntegrationErrorCode<"connection">
) {
  return withCookie(
    oauthPopupResponse(
      reason === undefined
        ? { integration, ok: true }
        : { integration, ok: false, error: reason },
      reason === undefined
        ? path.to.integrations
        : `${path.to.integrations}${integrationErrorSearch("connection", reason)}`
    ),
    cookie
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  // One redirect URI serves every piece, so the stored state is found by its
  // value, then checked against this session's user and company: that binding is
  // what stops a token being planted into another company's connection, or one
  // user's authorization code being completed in another user's session (CSRF).
  // Consumed first, so a refused consent spends it too.
  const consumed = await consumeOAuthStateByValue(
    request,
    searchParams.state ?? "",
    { userId, companyId }
  );
  const state = consumed.payload;
  // Which card the reply is for, so the right card shows a refusal.
  const replyTo = state?.integrationId ?? "connection";
  const connectionFailed = (reason: IntegrationErrorCode<"connection">) =>
    connectionReply(replyTo, consumed.cookie, reason);

  if (searchParams.error) {
    logger.error("Integration authorization refused", {
      error: searchParams.error
    });
    return connectionFailed("denied");
  }

  const parsed = oAuthCallbackSchema.safeParse(searchParams);
  if (!parsed.success) {
    // Parameter NAMES only — `code` is a live credential.
    logger.error("Invalid integration auth response", {
      params: Object.keys(searchParams)
    });
    return connectionFailed("invalid-response");
  }

  // A piece's state always names the account; one without it was issued for
  // another integration's flow.
  if (state === undefined || state.name === undefined) {
    logger.error("Integration callback state rejected", { companyId });
    return connectionFailed("invalid-state");
  }
  const pieceName = state.integrationId;
  const name = state.name;

  const entry = allowlistEntry(pieceName);
  if (entry === undefined) {
    return connectionFailed("invalid-state");
  }

  let app: ReturnType<typeof resolveOAuthApp>;
  let auth: Awaited<ReturnType<typeof getPieceOAuth2Auth>>;
  try {
    app = resolveOAuthApp(pieceName);
    auth = await getPieceOAuth2Auth(pieceName);
  } catch {
    return connectionFailed("not-configured");
  }

  // Each stage has its own try, so the error code is decided by WHERE it failed,
  // never by reading the text of whatever was thrown.
  let tokens: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
  try {
    tokens = await exchangeAuthorizationCode(
      {
        tokenUrl: auth.tokenUrl,
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        redirectUri: app.redirectUrl
      },
      parsed.data.code
    );
  } catch (err) {
    logger.error("Integration token exchange failed: {detail}", {
      detail: describeError(err)
    });
    return connectionFailed("token-exchange");
  }

  try {
    await createConnection(getCarbonServiceRole(), {
      companyId,
      pieceName,
      name,
      connectionId: state.connectionId,
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
      createdBy: userId
    });
  } catch (err) {
    if (err instanceof ConnectionAccountMismatchError) {
      return connectionFailed("account-mismatch");
    }
    if (err instanceof ConnectionNameTakenError) {
      return connectionFailed("duplicate-name");
    }
    if (err instanceof ConnectionWorkspaceTakenError) {
      logger.error("Integration workspace already connected elsewhere", {
        companyId,
        pieceName
      });
      return connectionFailed("workspace-taken");
    }
    logger.error("Integration connection save failed: {detail}", {
      detail: describeError(err)
    });
    return connectionFailed("save-failed");
  }

  // The piece is an ordinary integration card, so a connected account is what
  // "installed" means for it. Without this row the grid would keep offering
  // Install for an account that is already connected. Never overwrite an
  // existing row — it may hold settings that are not this callback's to touch.
  const installed = await markIntegrationInstalled(client, {
    id: pieceName,
    companyId,
    updatedBy: userId
  });
  if (installed.error) {
    logger.error("Integration install mark failed: {detail}", {
      detail: describeError(installed.error)
    });
    return connectionFailed("save-failed");
  }
  await invalidateIntegrationHealthCache(pieceName, companyId);

  return connectionReply(pieceName, consumed.cookie);
}

/** A PostgREST failure is a plain object, not an Error: its `message`, `code` and
 * `details` are the only clue to a constraint the write hit. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return `name=${err.name} detail=${err.message.slice(0, 400)}`;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(err) ?? String(err);
  } catch {
    serialized = String(err);
  }
  return `name=${typeof err} detail=${serialized.slice(0, 400)}`;
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
      headers: { Authorization: `Bearer ${accessToken}` },
      // A stalled identity endpoint must not hang the callback; the abort lands
      // in the catch below and the connection is saved without a label.
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const value = body[label.field];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
