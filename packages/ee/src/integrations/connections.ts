// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Named per-company connections to third-party integration pieces (Workflows).
 *
 * Separate from `secrets.ts`: that module serves `companyIntegration`, which holds
 * one row per integration per company and so cannot carry several named accounts.
 * These functions target `integrationConnection` and its own `connection:`-prefixed
 * vault RPCs.
 *
 * Tokens live in Supabase Vault and NEVER in `metadata`.
 */

export type ConnectionStatus = "Active" | "Expired" | "Revoked";

export interface ConnectionTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface IntegrationConnection {
  id: string;
  companyId: string;
  pieceName: string;
  name: string;
  authType: string;
  accountLabel: string | null;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  status: ConnectionStatus;
  lastError: string | null;
}

/** The connection is not usable until someone reconnects it. */
export class ConnectionRevokedError extends Error {
  constructor(
    public readonly connectionId: string,
    message = "This connection needs to be reconnected."
  ) {
    super(message);
    this.name = "ConnectionRevokedError";
  }
}

/** The vault holds no token for a connection that claims to have one (fail closed). */
export class ConnectionSecretUnavailableError extends Error {
  constructor(companyId: string, connectionId: string) {
    super(
      `Connection secret unavailable for ${connectionId} (company ${companyId})`
    );
    this.name = "ConnectionSecretUnavailableError";
  }
}

/**
 * The vendor answered the token request with `invalid_grant`: the grant itself is
 * revoked or invalid. Only this condemns a connection. A network failure, a 429, a
 * vendor 5xx, or an error about Carbon's own OAuth app (`invalid_client`) leaves
 * the row Active so the next use retries.
 */
export class ConnectionRejectedError extends Error {
  constructor(status: number) {
    super(`The connection was rejected (${status}).`);
    this.name = "ConnectionRejectedError";
  }
}

/** Another worker claimed the refresh and never finished it. */
export class ConnectionRefreshTimeoutError extends Error {
  constructor(connectionId: string) {
    super(`Timed out waiting for ${connectionId} to refresh.`);
    this.name = "ConnectionRefreshTimeoutError";
  }
}

export class ConnectionAccountMismatchError extends Error {
  constructor(connectionId: string) {
    super(`The authorized account does not match connection ${connectionId}.`);
    this.name = "ConnectionAccountMismatchError";
  }
}

/** Reconnect's identity read failed on an identified row: it may be another account. */
export class ConnectionAccountUnverifiedError extends Error {
  constructor(connectionId: string) {
    super(
      `The authorized account for connection ${connectionId} could not be verified.`
    );
    this.name = "ConnectionAccountUnverifiedError";
  }
}

export class ConnectionNameTakenError extends Error {
  constructor(name: string) {
    super(`A connection called "${name}" already exists.`);
    this.name = "ConnectionNameTakenError";
  }
}

/** The vendor workspace (`metadata.team_id`) is already connected to another
 * company. An inbound vendor event names only its workspace, so two companies on
 * one workspace would make every such event ambiguous for both. */
export class ConnectionWorkspaceTakenError extends Error {
  constructor(pieceName: string) {
    super(`This ${pieceName} workspace is connected to another company.`);
    this.name = "ConnectionWorkspaceTakenError";
  }
}

const SELECT_COLUMNS =
  "id, companyId, pieceName, name, authType, accountLabel, metadata, expiresAt, status, lastError";

/** Refresh a token this long before it actually expires. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
/** A claim older than this is treated as abandoned. */
const CLAIM_STALE_SECONDS = 30;
const POLL_INTERVAL_MS = 250;
const POLL_ATTEMPTS = 20;

/**
 * THE definition of an account a workflow step can actually act as.
 *
 * Every surface that asks "is this app connected?" — the settings card's health
 * badge, the Accounts tab, the builder's connection dropdown, the node's empty
 * state — must derive its answer from this one predicate. They disagreed before:
 * the card read `companyIntegration.active` (set once, at install) while the
 * builder counted rows in `integrationConnection`, so uninstalling or revoking an
 * account left Settings saying "Installed / Healthy" while the node said "isn't
 * connected yet". Two tables encoded one fact, and only one of them was true.
 */
export function connectionUsable(
  connection: Pick<IntegrationConnection, "status">
): boolean {
  // `status`, and nothing derived. An expired token is the NORMAL state — the
  // next use refreshes it — so judging usability by expiry hid working accounts
  // from the builder while Settings still listed them. When a refresh genuinely
  // fails, the refresh path records it here; that is what this reads.
  return connection.status === "Active";
}

/** The usable accounts, in the order `readConnections` returned them. */
export function usableConnections<
  T extends Pick<IntegrationConnection, "status">
>(connections: readonly T[]): T[] {
  return connections.filter(connectionUsable);
}

/**
 * Whether a piece's connections are in a state a workflow could actually use.
 *
 * NO accounts is not unhealthy — the card is Installed and both it and the builder
 * already offer a Connect button, so flagging it red would be noise. An account
 * that has GONE BAD is: every step using it fails, and nothing else tells anyone.
 */
export function connectionsHealthy(
  connections: readonly Pick<IntegrationConnection, "status">[]
): boolean {
  if (connections.length === 0) return true;
  return connections.some(connectionUsable);
}

/**
 * Scopes the vendor said it granted, recorded by the callback from the token
 * response (`metadata.scopes`; Slack separates with commas, the migration backfill
 * with spaces). `null` when the connection predates recording or the vendor does not
 * report them — a caller must never flag what it cannot see.
 */
export function grantedScopes(
  connection: Pick<IntegrationConnection, "metadata">
): string[] | null {
  const raw = connection.metadata.scopes;
  if (typeof raw !== "string") return null;
  const scopes = raw.split(/[\s,]+/).filter((s) => s.length > 0);
  return scopes.length === 0 ? null : scopes;
}

/**
 * Usable, but predates a scope the piece now needs — the one condition every
 * surface (Accounts tab, builder, card, step runner) must read the same way.
 */
export function needsReconnect(
  connection: Pick<IntegrationConnection, "status" | "metadata">,
  required: readonly string[]
): boolean {
  return (
    connectionUsable(connection) &&
    missingScopes(connection, required).length > 0
  );
}

/** Required scopes the connection does not hold. Empty when grants are unknown. */
export function missingScopes(
  connection: Pick<IntegrationConnection, "metadata">,
  required: readonly string[]
): string[] {
  const granted = grantedScopes(connection);
  if (granted === null) return [];
  const have = new Set(granted);
  return required.filter((scope) => !have.has(scope));
}

/**
 * The readers. `SELECT_COLUMNS` is a string, so supabase-js cannot infer the row
 * shape from it — these are the ONLY place that gap is bridged, rather than every
 * caller asserting the same shape for itself.
 */
export async function readConnections(
  client: SupabaseClient<Database>,
  companyId: string,
  pieceName?: string
): Promise<IntegrationConnection[]> {
  let query = client
    .from("integrationConnection")
    .select(SELECT_COLUMNS)
    .eq("companyId", companyId);
  if (pieceName !== undefined) query = query.eq("pieceName", pieceName);
  // A failed read must not look like "no connections": that would let an
  // uninstall finish with every vault token still valid, or report a company
  // Healthy when its rows could not be read at all.
  const { data, error } = await query.order("createdAt", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as IntegrationConnection[];
}

export async function readConnection(
  client: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
): Promise<IntegrationConnection | null> {
  // `null` means "not this company's connection" — a transient failure must
  // not be read as that, or it turns into a false "reconnect needed" prompt.
  const { data, error } = await client
    .from("integrationConnection")
    .select(SELECT_COLUMNS)
    .eq("companyId", companyId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as IntegrationConnection | null;
}

/**
 * Every company's connections of one piece to one vendor workspace
 * (`metadata.team_id`), oldest first. The one read that crosses companies: an
 * inbound vendor event names only its workspace, so the caller must check the
 * rows agree on a company before acting. Service role only.
 */
export async function readConnectionsByTeamId(
  serviceClient: SupabaseClient<Database>,
  pieceName: string,
  teamId: string
): Promise<IntegrationConnection[]> {
  // A failed read must not look like "no connection for this workspace".
  const { data, error } = await serviceClient
    .from("integrationConnection")
    .select(SELECT_COLUMNS)
    .eq("pieceName", pieceName)
    .eq("metadata->>team_id", teamId)
    .order("createdAt", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as IntegrationConnection[];
}

/** Which vendor account a connection acts as: the workspace for Slack, otherwise
 * the account label read back after consent. `null` when nothing identifies it. */
export function accountIdentity(
  accountLabel: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const teamId = metadata?.team_id;
  if (typeof teamId === "string" && teamId !== "") return `team:${teamId}`;
  return accountLabel ? `label:${accountLabel}` : null;
}

/** A stored row with no identity accepts any account. A stored identity must be
 * matched: an unidentified consent (the label read failed) is not the same account. */
export function sameAccount(
  stored: { accountLabel: string | null; metadata: unknown },
  incoming: {
    accountLabel?: string | null;
    metadata?: Record<string, unknown>;
  }
): boolean {
  const before = accountIdentity(
    stored.accountLabel,
    stored.metadata as Record<string, unknown> | null
  );
  const after = accountIdentity(incoming.accountLabel, incoming.metadata);
  return before === null || before === after;
}

export async function createConnection(
  serviceClient: SupabaseClient<Database>,
  args: {
    companyId: string;
    pieceName: string;
    name: string;
    /** Set by Reconnect: the one row this consent is for. */
    connectionId?: string;
    /** The name is the card's default, not one the user typed: when another
     * account holds it, the new account takes the next free name ("Gmail 2")
     * instead of being refused. Card Install after an Uninstall needs this, since
     * the revoked rows keep their names. */
    renameIfTaken?: boolean;
    authType?: string;
    accountLabel?: string | null;
    metadata?: Record<string, unknown>;
    tokens: ConnectionTokens;
    expiresAt?: string | null;
    createdBy: string;
  }
): Promise<{ id: string }> {
  // Refuse a workspace another company already uses. Only a usable connection
  // counts: a Revoked or Expired one no longer answers inbound events. Not
  // race-proof (no unique index spans companies), but it closes the ordinary path.
  const teamId = args.metadata?.team_id;
  if (typeof teamId === "string" && teamId !== "") {
    const sameWorkspace = await readConnectionsByTeamId(
      serviceClient,
      args.pieceName,
      teamId
    );
    if (
      sameWorkspace.some(
        (row) => row.companyId !== args.companyId && connectionUsable(row)
      )
    ) {
      throw new ConnectionWorkspaceTakenError(args.pieceName);
    }
  }

  // A consent REVIVES an existing row (by id for Reconnect, by name otherwise) so
  // saved workflow nodes keep their reference — but only for the SAME account, or
  // every workflow on the row would silently start acting as someone else.
  const lookup = serviceClient
    .from("integrationConnection")
    .select("id, accountLabel, metadata")
    .eq("companyId", args.companyId)
    .eq("pieceName", args.pieceName);
  const existing = await (args.connectionId === undefined
    ? lookup.eq("name", args.name)
    : lookup.eq("id", args.connectionId)
  ).maybeSingle();
  if (existing.error) throw existing.error;

  if (args.connectionId !== undefined && existing.data === null) {
    throw new Error(`Connection ${args.connectionId} was not found.`);
  }

  let name = args.name;
  let revive = existing.data;
  if (existing.data !== null && !sameAccount(existing.data, args)) {
    if (args.connectionId !== undefined) {
      throw accountIdentity(args.accountLabel, args.metadata) === null
        ? new ConnectionAccountUnverifiedError(existing.data.id)
        : new ConnectionAccountMismatchError(existing.data.id);
    }
    if (!args.renameIfTaken) throw new ConnectionNameTakenError(args.name);
    name = await freeConnectionName(
      serviceClient,
      args.companyId,
      args.pieceName,
      args.name
    );
    revive = null;
  }

  // One RPC writes the row (revive or insert) and the vault secret together, so a
  // failure can neither leave a Revoked row holding a live token nor an Active row
  // with no token.
  const { data, error } = await serviceClient.rpc("save_connection", {
    p_company_id: args.companyId,
    p_piece_name: args.pieceName,
    p_name: name,
    p_auth_type: args.authType ?? "OAUTH2",
    p_secret: args.tokens as never,
    p_user_id: args.createdBy,
    p_account_label: args.accountLabel ?? undefined,
    // A re-consent's token response is authoritative — its `scopes` is how a
    // "reconnect needed" account clears. Omitted keeps the stored metadata.
    p_metadata: args.metadata as never,
    p_expires_at: args.expiresAt ?? undefined,
    ...(revive === null ? {} : { p_connection_id: revive.id })
  });

  // Two people adding the same name at once: the unique index decides.
  if (error?.code === "23505") throw new ConnectionNameTakenError(name);
  if (error || typeof data !== "string") {
    throw error ?? new Error("Connection not saved.");
  }
  return { id: data };
}

/** `base` followed by the first number no connection of the piece is named. */
async function freeConnectionName(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  pieceName: string,
  base: string
): Promise<string> {
  const { data, error } = await serviceClient
    .from("integrationConnection")
    .select("name")
    .eq("companyId", companyId)
    .eq("pieceName", pieceName);
  if (error) throw error;
  const taken = new Set(data.map((row) => row.name));
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

export async function renameConnection(
  client: SupabaseClient<Database>,
  companyId: string,
  connectionId: string,
  name: string,
  updatedBy: string
) {
  return client
    .from("integrationConnection")
    .update({ name, updatedBy, updatedAt: new Date().toISOString() })
    .eq("companyId", companyId)
    .eq("id", connectionId);
}

/**
 * Drops the token and marks the row revoked, in one statement
 * (`revoke_connections`): an Active row whose secret is already gone reads as a
 * usable account that fails every use. The row itself SURVIVES: a saved workflow
 * node may reference the id, and a dangling id produces a worse error than a
 * clear "reconnect this" message.
 */
export async function disconnectConnection(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  pieceName: string,
  connectionId: string,
  updatedBy: string
) {
  const { error } = await serviceClient.rpc("revoke_connections", {
    p_company_id: companyId,
    p_piece_name: pieceName,
    p_updated_by: updatedBy,
    p_connection_id: connectionId
  });
  if (error) throw new Error(error.message);
}

/**
 * Revokes every account connected to one piece — what uninstalling its card means.
 * Generic rather than per-vendor, so a new piece registers this instead of adding a
 * hooks file of its own. Leaving live tokens behind would hand the customer
 * credentials they can no longer see.
 */
export async function revokeConnectionsForPiece(
  serviceClient: SupabaseClient<Database>,
  pieceName: string,
  companyId: string
): Promise<void> {
  const { error } = await serviceClient.rpc("revoke_connections", {
    p_company_id: companyId,
    p_piece_name: pieceName,
    p_updated_by: "system"
  });
  if (error) throw new Error(error.message);
}

async function writeTokens(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string,
  tokens: ConnectionTokens
): Promise<void> {
  const { error } = await serviceClient.rpc("upsert_connection_secret", {
    p_company_id: companyId,
    p_connection_id: connectionId,
    p_secret: tokens as never
  });
  // The function writes only onto an Active row: one disconnected while its
  // token was being refreshed answers no_data_found and stays revoked.
  if (error?.code === "P0002") throw new ConnectionRevokedError(connectionId);
  if (error)
    throw new ConnectionSecretUnavailableError(companyId, connectionId);
}

async function readTokens(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
): Promise<ConnectionTokens> {
  const { data, error } = await serviceClient.rpc("get_connection_secret", {
    p_company_id: companyId,
    p_connection_id: connectionId
  });
  if (error || data === null || typeof data !== "object") {
    throw new ConnectionSecretUnavailableError(companyId, connectionId);
  }
  const bag = data as { accessToken?: string; refreshToken?: string };
  if (typeof bag.accessToken !== "string") {
    throw new ConnectionSecretUnavailableError(companyId, connectionId);
  }
  return { accessToken: bag.accessToken, refreshToken: bag.refreshToken };
}

/** Inside the refresh window, so a use must refresh first. No expiry never expires. */
export function expiringSoon(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  return Date.parse(expiresAt) - Date.now() <= REFRESH_WINDOW_MS;
}

/**
 * Claim the refresh with a conditional UPDATE. A Postgres advisory lock would
 * release at the RPC's transaction end, which is before the token exchange
 * finishes — this claim survives it. Returns true when we own the refresh.
 *
 * Two sequential single-filter updates, NOT one `.or(...)`: PostgREST (13.0.8)
 * builds the or-tree of a mutation with an unquoted table qualifier, so on a
 * camelCase table like this one every such UPDATE fails with 42703 — which,
 * with the error then discarded, read as "someone else holds the claim" and
 * surfaced to the customer as an endless "still being reconnected". The split
 * is race-safe: under READ COMMITTED the second writer re-checks its WHERE
 * against the row the first one committed, so exactly one caller wins.
 *
 * A DB error is thrown, never folded into "claim lost": the losing path polls
 * for a refresh that no one is doing, and the timeout it ends in names nothing.
 */
async function claimRefresh(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(
    now.getTime() - CLAIM_STALE_SECONDS * 1000
  ).toISOString();

  // The common case: nobody is refreshing.
  const fresh = await serviceClient
    .from("integrationConnection")
    .update({ refreshingAt: now.toISOString() })
    .eq("companyId", companyId)
    .eq("id", connectionId)
    .is("refreshingAt", null)
    .select("id");
  if (fresh.error) throw new Error(fresh.error.message);
  if (Array.isArray(fresh.data) && fresh.data.length > 0) return true;

  // A claim exists — take it over only if its holder has been gone too long.
  const stale = await serviceClient
    .from("integrationConnection")
    .update({ refreshingAt: now.toISOString() })
    .eq("companyId", companyId)
    .eq("id", connectionId)
    .lt("refreshingAt", staleBefore)
    .select("id");
  if (stale.error) throw new Error(stale.error.message);
  return Array.isArray(stale.data) && stale.data.length > 0;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface OAuth2RefreshConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

/**
 * The fresh access token for a connection, refreshing it first when it is close
 * to expiry. The one function a workflow step or an options lookup calls.
 */
export async function resolveConnectionAuth(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string,
  oauth: OAuth2RefreshConfig
): Promise<{ accessToken: string; connection: IntegrationConnection }> {
  const connection = await readConnection(
    serviceClient,
    companyId,
    connectionId
  );
  if (connection === null || connection.status !== "Active") {
    throw new ConnectionRevokedError(connectionId);
  }

  const tokens = await readTokens(serviceClient, companyId, connectionId);
  if (!expiringSoon(connection.expiresAt)) {
    return { accessToken: tokens.accessToken, connection };
  }

  if (tokens.refreshToken === undefined) {
    await markExpired(
      serviceClient,
      companyId,
      connectionId,
      "No refresh token was stored for this connection."
    );
    throw new ConnectionRevokedError(connectionId);
  }

  const claimed = await claimRefresh(serviceClient, companyId, connectionId);
  if (!claimed) {
    // Someone else is refreshing; wait for their token rather than racing them.
    return {
      accessToken: await awaitRefreshedToken(
        serviceClient,
        companyId,
        connectionId
      ),
      connection
    };
  }

  // Everything from here until the claim is cleared must release it on ANY failure.
  // `claimRefresh` writes a fresh `refreshingAt` when it wins, so a throw in between
  // leaves a live 30-second claim: every later request loses the claim, polls for
  // the full 5 seconds, and fails with a timeout that names nothing. Only the token
  // exchange used to be guarded — a vault write that threw stranded the claim.
  //
  // Re-read the row and its tokens AFTER winning: the reads above happened before
  // the claim, so another worker may have refreshed in between. Exchanging the
  // refresh token read earlier would send a rotated-away token, get `invalid_grant`
  // and condemn a healthy connection.
  let current: IntegrationConnection | null;
  let currentTokens: ConnectionTokens | null = null;
  try {
    current = await readConnection(serviceClient, companyId, connectionId);
    if (current !== null && current.status === "Active") {
      currentTokens = await readTokens(serviceClient, companyId, connectionId);
    }
  } catch (cause) {
    await releaseClaim(serviceClient, companyId, connectionId);
    throw cause;
  }
  if (current === null || currentTokens === null) {
    await releaseClaim(serviceClient, companyId, connectionId);
    throw new ConnectionRevokedError(connectionId);
  }
  if (!expiringSoon(current.expiresAt)) {
    // Someone refreshed between our first read and our claim.
    await releaseClaim(serviceClient, companyId, connectionId);
    return { accessToken: currentTokens.accessToken, connection: current };
  }
  const refreshToken = currentTokens.refreshToken;
  if (refreshToken === undefined) {
    await markExpired(
      serviceClient,
      companyId,
      connectionId,
      "No refresh token was stored for this connection."
    );
    throw new ConnectionRevokedError(connectionId);
  }

  let refreshed: ExchangedTokens;
  try {
    refreshed = await exchangeRefreshToken(oauth, refreshToken);
  } catch (cause) {
    // Only a definitive vendor rejection condemns the connection; a network error
    // or vendor 5xx is transient, so release the claim and let the next use retry.
    if (cause instanceof ConnectionRejectedError) {
      await markExpired(serviceClient, companyId, connectionId, cause.message);
      throw new ConnectionRevokedError(connectionId);
    }
    await releaseClaim(serviceClient, companyId, connectionId);
    throw cause;
  }

  try {
    await writeTokens(serviceClient, companyId, connectionId, {
      accessToken: refreshed.accessToken,
      // Google omits the refresh token on a refresh response; keep the stored one.
      refreshToken: refreshed.refreshToken ?? refreshToken
    });

    // Only a row still Active: a disconnect between the token write and here
    // has deleted the token, and must not be undone.
    const settled = await serviceClient
      .from("integrationConnection")
      .update({
        expiresAt: refreshed.expiresAt,
        refreshingAt: null,
        lastError: null
      })
      .eq("companyId", companyId)
      .eq("id", connectionId)
      .eq("status", "Active")
      .select("id");
    // A silent failure here leaves `expiresAt` stale and the claim held, so every
    // later request loses the claim and polls out a timeout that names nothing.
    if (settled.error) throw new Error(settled.error.message);
    if (settled.data.length === 0) {
      throw new ConnectionRevokedError(connectionId);
    }
  } catch (cause) {
    // The token itself is fine — storing it was not. Release the claim so the next
    // attempt can retry immediately rather than waiting out a phantom refresh.
    await releaseClaim(serviceClient, companyId, connectionId);
    throw cause;
  }

  return {
    accessToken: refreshed.accessToken,
    connection: { ...current, expiresAt: refreshed.expiresAt }
  };
}

/**
 * The stored access token for a vendor whose tokens do not expire (Slack bot tokens),
 * for callers outside a workflow step — the Assistant's slash commands and thread
 * sync. Takes the row the caller already read, so the guard below judges exactly
 * the connection it picked. Refuses anything it cannot vouch for: a non-Active
 * connection, or one that carries an expiry inside the refresh window (a
 * refreshable vendor must go through `resolveConnectionAuth`, which owns the
 * refresh claim).
 */
export async function readConnectionAccessToken(
  serviceClient: SupabaseClient<Database>,
  connection: Pick<
    IntegrationConnection,
    "id" | "companyId" | "status" | "expiresAt"
  >
): Promise<string> {
  if (!connectionUsable(connection)) {
    throw new ConnectionRevokedError(connection.id);
  }
  if (expiringSoon(connection.expiresAt)) {
    throw new Error(
      `Connection ${connection.id} carries an expiring token; use resolveConnectionAuth.`
    );
  }
  return (await readTokens(serviceClient, connection.companyId, connection.id))
    .accessToken;
}

async function awaitRefreshedToken(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
): Promise<string> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await wait(POLL_INTERVAL_MS);
    const current = await readConnection(
      serviceClient,
      companyId,
      connectionId
    );
    if (current === null) break;
    if (current.status !== "Active") {
      throw new ConnectionRevokedError(connectionId);
    }
    if (!expiringSoon(current.expiresAt)) {
      const tokens = await readTokens(serviceClient, companyId, connectionId);
      return tokens.accessToken;
    }
  }
  throw new ConnectionRefreshTimeoutError(connectionId);
}

/** Drop a refresh claim without touching status — the connection may still be fine.
 * A failed release is thrown, never swallowed: the stale-claim takeover bounds the
 * damage at 30 seconds, but the caller should not report a clean retry it did not get. */
async function releaseClaim(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
): Promise<void> {
  const { error } = await serviceClient
    .from("integrationConnection")
    .update({ refreshingAt: null })
    .eq("companyId", companyId)
    .eq("id", connectionId);
  if (error) throw new Error(error.message);
}

async function markExpired(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string,
  lastError: string
): Promise<void> {
  // A failed write here would leave a condemned connection Active — the next use
  // would retry a grant the vendor already rejected instead of saying "reconnect".
  // A Revoked row stays Revoked: the account was disconnected on purpose.
  const { error } = await serviceClient
    .from("integrationConnection")
    .update({ status: "Expired", lastError, refreshingAt: null })
    .eq("companyId", companyId)
    .eq("id", connectionId)
    .neq("status", "Revoked");
  if (error) throw new Error(error.message);
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string | null;
  /** The parsed token response, in memory only — never persisted whole. A piece's
   * allowlist row may pick workspace facts (Slack's team and webhook channel) off it. */
  body: Record<string, unknown>;
}

/** How long any call to a vendor's OAuth endpoints may take. A stalled endpoint
 * would otherwise hang the OAuth callback or a step's refresh with it. */
export const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The one token-endpoint call. Server-side only — `client_secret` must never reach
 * the browser. A failure throws; the OAuth callback picks its error code by which
 * stage threw, never by reading this message.
 */
async function postTokenRequest(
  tokenUrl: string,
  body: Record<string, string>
): Promise<ExchangedTokens> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    // The abort throws, which every caller treats as transient — exactly right
    // for a vendor that stopped answering.
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    // Only `invalid_grant` says the grant itself is gone, so only it condemns the
    // connection. Everything else stays retryable: a 429 or vendor 5xx, a
    // transient OAuth code, and `invalid_client` / `unauthorized_client`, which
    // arrive with the same 400/401 but mean Carbon's own OAuth app is
    // misconfigured (a rotated secret) — condemning on those would mark every
    // account Expired, and fixing the secret would not bring them back.
    const code = await oauthErrorCode(response);
    if (code === "invalid_grant") {
      throw new ConnectionRejectedError(response.status);
    }
    throw new Error(
      `The vendor token endpoint failed (${response.status}${code ? `: ${code}` : ""}).`
    );
  }
  return readTokenResponse(await response.json());
}

async function oauthErrorCode(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : undefined;
  } catch {
    return undefined;
  }
}

export async function exchangeRefreshToken(
  oauth: OAuth2RefreshConfig,
  refreshToken: string
): Promise<ExchangedTokens> {
  return postTokenRequest(oauth.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret
  });
}

/** Swaps an authorization code for the first token pair. */
export async function exchangeAuthorizationCode(
  oauth: OAuth2RefreshConfig & { redirectUri: string },
  code: string
): Promise<ExchangedTokens> {
  return postTokenRequest(oauth.tokenUrl, {
    grant_type: "authorization_code",
    code,
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    redirect_uri: oauth.redirectUri
  });
}

function readTokenResponse(payload: unknown): ExchangedTokens {
  const body = payload as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (typeof body.access_token !== "string") {
    // Slack rejects with HTTP 200 and `{ ok: false, error }`; name it for the server
    // log. The browser never sees it — the callback answers a code.
    throw new Error(
      typeof body.error === "string"
        ? `The connection returned no access token (${body.error}).`
        : "The connection returned no access token."
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt:
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : null,
    body: (payload ?? {}) as Record<string, unknown>
  };
}
