// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { issueOAuthState } from "@carbon/auth/oauth-state.server";
import { readConnection } from "@carbon/ee/integrations/connections";
import {
  allowlistEntry,
  buildConsentUrl,
  getPieceOAuth2Auth,
  resolveOAuthApp
} from "@carbon/jobs/integrations";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import type {
  IntegrationErrorCode,
  SharedIntegrationErrorCode
} from "~/modules/settings/integration-errors";
import { pieceConnectRefusal } from "~/modules/settings/settings.service";

export const config = {
  runtime: "nodejs"
};

/**
 * Builds the vendor's consent URL: the piece supplies `authUrl` and `scope` (an
 * allowlist row may override either), the allowlist row supplies which env vars hold
 * our OAuth app. Returns `{ url }`, so the client opens it in a popup, or
 * `{ error }` — a `connection` code from `integration-errors.ts`, worded in the UI.
 *
 * The `{ url }` response sets the state cookie (`issueOAuthState`): single-use,
 * bound to this user and company, and carrying the account name and, for
 * Reconnect, the row's id, so the callback trusts nothing from the query string.
 *
 * `?connection=<id>` is Reconnect: the callback revives that row only if the same
 * account authorizes. `?name=` is Add account.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    { update: "settings" }
  );

  const pieceName = params.piece;
  const entry = pieceName ? allowlistEntry(pieceName) : undefined;
  if (!pieceName || entry === undefined) {
    return connectError("unavailable");
  }

  const refusal = await pieceConnectRefusal(client, {
    companyId,
    integrationId: pieceName,
    email,
    userId
  });
  if (refusal !== null) return connectError(refusal);

  let app: ReturnType<typeof resolveOAuthApp>;
  try {
    app = resolveOAuthApp(pieceName);
  } catch {
    return connectError("not-configured");
  }

  const searchParams = new URL(request.url).searchParams;
  const connectionId = searchParams.get("connection") ?? undefined;
  let name = searchParams.get("name")?.trim() || entry.label;
  if (connectionId !== undefined) {
    const existing = await readConnection(
      getCarbonServiceRole(),
      companyId,
      connectionId
    );
    if (existing === null || existing.pieceName !== pieceName) {
      return connectError("account-missing");
    }
    name = existing.name;
  }

  const auth = await getPieceOAuth2Auth(pieceName);

  // Pass the request so another integration's pending state in the cookie
  // survives this Set-Cookie.
  const { state, cookie } = await issueOAuthState(
    { integrationId: pieceName, userId, companyId, name, connectionId },
    request
  );

  return data(
    { url: buildConsentUrl({ entry, auth, app, state }) },
    { headers: { "Set-Cookie": cookie } }
  );
}

function connectError(
  error: IntegrationErrorCode<"connection"> | SharedIntegrationErrorCode
) {
  return { error };
}
