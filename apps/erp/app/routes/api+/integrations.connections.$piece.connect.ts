// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { readConnection } from "@carbon/ee/integrations/connections";
import {
  allowlistEntry,
  buildConsentUrl,
  getPieceOAuth2Auth,
  resolveOAuthApp
} from "@carbon/jobs/integrations";
import type { LoaderFunctionArgs } from "react-router";
import { signConnectionState } from "~/modules/settings/connection-state.server";

export const config = {
  runtime: "nodejs"
};

/**
 * Builds the vendor's consent URL: the piece supplies `authUrl` and `scope` (an
 * allowlist row may override either), the allowlist row supplies which env vars hold
 * our OAuth app. Returns `{ url }`, so the client opens it in a popup.
 *
 * `?connection=<id>` is Reconnect: the id is signed into the state, and the callback
 * revives that row only if the same account authorizes. `?name=` is Add account.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const pieceName = params.piece;
  const entry = pieceName ? allowlistEntry(pieceName) : undefined;
  if (!pieceName || entry === undefined) {
    return { error: "That integration is not available." };
  }

  let app: ReturnType<typeof resolveOAuthApp>;
  try {
    app = resolveOAuthApp(pieceName);
  } catch {
    // Names the vendor rather than the missing variable: this reaches a customer.
    return {
      error: `This Carbon instance has no ${entry.label} OAuth app configured.`
    };
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
      return { error: "That account no longer exists." };
    }
    name = existing.name;
  }

  const auth = await getPieceOAuth2Auth(pieceName);

  return {
    url: buildConsentUrl({
      entry,
      auth,
      app,
      state: signConnectionState({
        companyId,
        pieceName,
        name,
        connectionId,
        userId
      })
    })
  };
}
