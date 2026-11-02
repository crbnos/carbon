// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
// The deep subpath, not the `@carbon/ee` root: that barrel pulls in integration
// config files whose `msg` macro is untransformed outside a Vite build.
import {
  ConnectionRefreshTimeoutError,
  ConnectionRevokedError,
  ConnectionSecretUnavailableError,
  missingScopes,
  type OAuth2RefreshConfig,
  readConnection,
  resolveConnectionAuth
} from "@carbon/ee/integrations/connections";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRefreshConfig, requiredScopesFor } from "./oauth";

/** Why a connection cannot act for a piece right now. Each caller words it. */
export type PieceAuthFailure =
  /** Not this company's connection, or another piece's. */
  | { reason: "no-connection" }
  /** Usable, but predates a scope the piece now needs. */
  | { reason: "missing-scopes" }
  /** Another caller holds the refresh claim — transient, a retry fixes it. */
  | { reason: "refreshing" }
  /** Revoked, or its token cannot be read — a person must reconnect it. */
  | { reason: "reconnect" }
  /** The piece's OAuth app could not be loaded: ours, not the account's. */
  | { reason: "misconfigured"; cause: unknown }
  /** Anything else the token refresh threw. */
  | { reason: "failed"; cause: unknown };

export type PieceAuth =
  | { ok: true; accessToken: string }
  | ({ ok: false } & PieceAuthFailure);

/**
 * The access token a piece runs with, through one connection — the ONE copy of
 * "read the row, check it is this piece's, check its scopes, refresh it", shared
 * by the step runner and the builder's property options so the two cannot drift.
 *
 * `serviceClient` must be the service role: the vault RPCs are granted to it
 * alone, and the row's RLS asks for `settings_view`, which a workflow author
 * need not have. Every query is scoped by `companyId`, which the caller takes
 * from the run or the request — never from the definition. A failed row read
 * throws rather than reading as "no connection".
 */
export async function resolvePieceAuth(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  pieceName: string,
  connectionId: string
): Promise<PieceAuth> {
  const owned = await readConnection(serviceClient, companyId, connectionId);
  if (owned === null || owned.pieceName !== pieceName) {
    return { ok: false, reason: "no-connection" };
  }

  // Deterministic first: an under-scoped account fails here, without a vendor
  // call and without partial side effects.
  if (missingScopes(owned, await requiredScopesFor(pieceName)).length > 0) {
    return { ok: false, reason: "missing-scopes" };
  }

  // Apart from the refresh below: a missing package or an unset OAuth env var
  // has nothing to do with the account, and reconnecting cannot fix it.
  let oauth: OAuth2RefreshConfig;
  try {
    oauth = await buildRefreshConfig(pieceName);
  } catch (cause) {
    return { ok: false, reason: "misconfigured", cause };
  }

  try {
    const { accessToken } = await resolveConnectionAuth(
      serviceClient,
      companyId,
      connectionId,
      oauth
    );
    return { ok: true, accessToken };
  } catch (cause) {
    if (cause instanceof ConnectionRefreshTimeoutError) {
      return { ok: false, reason: "refreshing" };
    }
    if (
      cause instanceof ConnectionRevokedError ||
      cause instanceof ConnectionSecretUnavailableError
    ) {
      return { ok: false, reason: "reconnect" };
    }
    return { ok: false, reason: "failed", cause };
  }
}
