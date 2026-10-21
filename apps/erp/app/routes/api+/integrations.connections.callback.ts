// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  ConnectionAccountMismatchError,
  ConnectionNameTakenError,
  createConnection,
  exchangeAuthorizationCode
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
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import type { IntegrationErrorCode } from "~/modules/settings/integration-errors";
import { integrationErrorSearch } from "~/modules/settings/integration-errors";
import {
  invalidateIntegrationHealthCache,
  markIntegrationInstalled,
  verifyConnectionState
} from "~/modules/settings/settings.service";
import { oAuthCallbackSchema } from "~/modules/shared/shared.models";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations", "connections");

// A path on this origin: the vendor sent the browser to this callback, so the
// integrations page is on the same host.
function integrationsUrl() {
  return path.to.integrations;
}

/** The vendor redirects the browser here, so a failure must render as something
 * actionable. Only a code crosses the URL; `integrationErrors` owns the copy. */
function connectionFailed(
  request: Request,
  reason: IntegrationErrorCode<"connection">
) {
  return redirect(
    `${integrationsUrl()}${integrationErrorSearch("connection", reason)}`
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
  // connection; the session checks on top stop a replay into a company the
  // signer no longer sits in, and stop one user's authorization code being
  // completed inside another user's session (CSRF).
  const state = verifyConnectionState(parsed.data.state);
  if (
    state === null ||
    state.companyId !== companyId ||
    state.userId !== userId
  ) {
    logger.error("Integration callback state rejected", {
      companyMatched: state?.companyId === companyId,
      userMatched: state?.userId === userId
    });
    return connectionFailed(request, "invalid-state");
  }

  const entry = allowlistEntry(state.pieceName);
  if (entry === undefined) {
    return connectionFailed(request, "invalid-state");
  }

  let app: ReturnType<typeof resolveOAuthApp>;
  let auth: Awaited<ReturnType<typeof getPieceOAuth2Auth>>;
  try {
    app = resolveOAuthApp(state.pieceName);
    auth = await getPieceOAuth2Auth(state.pieceName);
  } catch {
    return connectionFailed(request, "not-configured");
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
    return connectionFailed(request, "token-exchange");
  }

  try {
    await createConnection(getCarbonServiceRole(), {
      companyId,
      pieceName: state.pieceName,
      name: state.name,
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
      createdBy: state.userId
    });
  } catch (err) {
    if (err instanceof ConnectionAccountMismatchError) {
      return connectionFailed(request, "account-mismatch");
    }
    if (err instanceof ConnectionNameTakenError) {
      return connectionFailed(request, "duplicate-name");
    }
    logger.error("Integration connection save failed: {detail}", {
      detail: describeError(err)
    });
    return connectionFailed(request, "save-failed");
  }

  // The piece is an ordinary integration card, so a connected account is what
  // "installed" means for it. Without this row the grid would keep offering
  // Install for an account that is already connected. Never overwrite an
  // existing row — it may hold settings that are not this callback's to touch.
  const installed = await markIntegrationInstalled(client, {
    id: state.pieceName,
    companyId,
    updatedBy: userId
  });
  if (installed.error) {
    logger.error("Integration install mark failed: {detail}", {
      detail: describeError(installed.error)
    });
    return connectionFailed(request, "save-failed");
  }
  await invalidateIntegrationHealthCache(state.pieceName, companyId);

  return redirect(integrationsUrl());
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
