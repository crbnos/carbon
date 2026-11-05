// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { consumeOAuthStateByValue } from "@carbon/auth/oauth-state.server";
import { getIntegrationServerHooks } from "@carbon/ee/hooks.server";
import {
  ConnectionAccountMismatchError,
  ConnectionAccountUnverifiedError,
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
import type {
  IntegrationErrorCode,
  SharedIntegrationErrorCode
} from "~/modules/settings/integration-errors";
import { integrationErrorSearch } from "~/modules/settings/integration-errors";
import {
  invalidateIntegrationHealthCache,
  markIntegrationInstalled,
  oauthPopupResponse,
  pieceConnectRefusal,
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
  reason?: IntegrationErrorCode<"connection"> | SharedIntegrationErrorCode
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
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    { update: "settings" }
  );

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
  const connectionFailed = (
    reason: IntegrationErrorCode<"connection"> | SharedIntegrationErrorCode
  ) => connectionReply(replyTo, consumed.cookie, reason);

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

  // Checked again here, before the code is exchanged: the state may have been
  // issued before the card was switched off or the plan changed.
  const refusal = await pieceConnectRefusal(client, {
    companyId,
    integrationId: pieceName,
    email,
    userId
  });
  if (refusal !== null) return connectionFailed(refusal);

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

  // Workspace facts the row asked for (Slack: team, bot user, webhook channel).
  const metadata = connectionMetadataFrom(entry, tokens.body);
  try {
    await createConnection(getCarbonServiceRole(), {
      companyId,
      pieceName,
      name,
      connectionId: state.connectionId,
      // Card Install names the account after the card; a Revoked row from an
      // earlier install may still hold that name for another account.
      renameIfTaken: state.connectionId === undefined && name === entry.label,
      authType: "OAUTH2",
      accountLabel:
        accountLabelFromBody(entry, tokens.body) ??
        (await accountLabelFor(entry, tokens.accessToken)),
      metadata,
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
    if (err instanceof ConnectionAccountUnverifiedError) {
      logger.error("Integration reconnect account not identified", {
        companyId,
        pieceName
      });
      return connectionFailed("account-unverified");
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
  // The service role, as for the connection: inserting the row would need
  // settings create through RLS, and this route (like every install) requires
  // settings update. Failing here would leave a live token behind a card that
  // still offers Install.
  const installed = await markIntegrationInstalled(getCarbonServiceRole(), {
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

  // A new account (not a Reconnect) runs its piece's connect hook, e.g. Slack's
  // welcome message. Best-effort: the connection is already saved.
  const onConnect = getIntegrationServerHooks(pieceName)?.onConnect;
  if (onConnect !== undefined && state.connectionId === undefined) {
    try {
      await onConnect({ accessToken: tokens.accessToken, metadata });
    } catch (err) {
      logger.warn("Integration connect hook failed: {detail}", {
        pieceName,
        detail: describeError(err)
      });
    }
  }

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
