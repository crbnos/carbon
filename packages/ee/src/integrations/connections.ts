import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Named per-company connections to third-party integration pieces (Workflows).
 *
 * Separate from `secrets.ts`: that module serves `companyIntegration`, which holds
 * one row per integration per company and so cannot carry several named accounts.
 * These functions target `integrationConnection` and its own `connection:`-prefixed
 * vault RPCs. The 12 existing integrations keep their path untouched.
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

/** Another worker claimed the refresh and never finished it. */
export class ConnectionRefreshTimeoutError extends Error {
  constructor(connectionId: string) {
    super(`Timed out waiting for ${connectionId} to refresh.`);
    this.name = "ConnectionRefreshTimeoutError";
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
 * The two readers. `SELECT_COLUMNS` is a string, so supabase-js cannot infer the row
 * shape from it — these are the ONLY place that gap is bridged, rather than every
 * caller asserting the same shape for itself.
 */
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
  const { data } = await query.order("createdAt", { ascending: true });
  return (data ?? []) as unknown as IntegrationConnection[];
}

export async function readConnection(
  client: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
): Promise<IntegrationConnection | null> {
  const { data } = await client
    .from("integrationConnection")
    .select(SELECT_COLUMNS)
    .eq("companyId", companyId)
    .eq("id", connectionId)
    .maybeSingle();
  return (data ?? null) as unknown as IntegrationConnection | null;
}

export async function createConnection(
  serviceClient: SupabaseClient<Database>,
  args: {
    companyId: string;
    pieceName: string;
    name: string;
    authType?: string;
    accountLabel?: string | null;
    metadata?: Record<string, unknown>;
    tokens: ConnectionTokens;
    expiresAt?: string | null;
    createdBy: string;
  }
): Promise<{ id: string }> {
  // Reconnecting a broken account REVIVES its row rather than inserting beside it.
  // `disconnectConnection` deliberately keeps the row so a saved workflow node's
  // reference stays valid — but the name is unique per piece, so a fresh insert
  // under the same name always collided, and the only account the customer wanted
  // to fix was the one they could never re-add.
  const existing = await serviceClient
    .from("integrationConnection")
    .select("id")
    .eq("companyId", args.companyId)
    .eq("pieceName", args.pieceName)
    .eq("name", args.name)
    .maybeSingle();

  if (existing.data?.id) {
    const id = existing.data.id;
    await writeTokens(serviceClient, args.companyId, id, args.tokens);
    const { error: reviveError } = await serviceClient
      .from("integrationConnection")
      .update({
        authType: args.authType ?? "OAUTH2",
        accountLabel: args.accountLabel ?? null,
        expiresAt: args.expiresAt ?? null,
        refreshingAt: null,
        status: "Active",
        lastError: null,
        updatedBy: args.createdBy
      })
      .eq("companyId", args.companyId)
      .eq("id", id);
    if (reviveError) throw new Error(reviveError.message);
    return { id };
  }

  const { data, error } = await serviceClient
    .from("integrationConnection")
    .insert({
      companyId: args.companyId,
      pieceName: args.pieceName,
      name: args.name,
      authType: args.authType ?? "OAUTH2",
      accountLabel: args.accountLabel ?? null,
      // Non-secret configuration only — tokens go to the vault below.
      metadata: (args.metadata ?? {}) as never,
      expiresAt: args.expiresAt ?? null,
      status: "Active",
      createdBy: args.createdBy
    })
    .select("id")
    .single();

  if (error || data === null) throw error ?? new Error("Connection not saved.");

  await writeTokens(serviceClient, args.companyId, data.id, args.tokens);
  return { id: data.id };
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
 * Drops the token and marks the row revoked. The row itself SURVIVES: a saved
 * workflow node may reference the id, and a dangling id produces a worse error
 * than a clear "reconnect this" message.
 */
export async function disconnectConnection(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string,
  updatedBy: string
) {
  const { error } = await serviceClient.rpc("delete_connection_secret", {
    p_company_id: companyId,
    p_connection_id: connectionId
  });
  if (error) throw error;

  return serviceClient
    .from("integrationConnection")
    .update({
      status: "Revoked",
      secretRef: null,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("companyId", companyId)
    .eq("id", connectionId);
}

/**
 * Revokes every account connected to one piece — what uninstalling its card means.
 * Generic rather than per-vendor, so a new piece registers this instead of adding a
 * hooks file of its own. Leaving live tokens behind would hand the customer
 * credentials they can no longer see.
 *
 * Serial: each disconnect is a vault RPC plus a row update, and a company has a
 * handful of accounts, not thousands.
 */
export async function revokeConnectionsForPiece(
  serviceClient: SupabaseClient<Database>,
  pieceName: string,
  companyId: string
): Promise<void> {
  const connections = await readConnections(
    serviceClient,
    companyId,
    pieceName
  );
  for (const connection of connections) {
    if (connection.status === "Revoked") continue;
    await disconnectConnection(
      serviceClient,
      companyId,
      connection.id,
      "system"
    );
  }
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

function expiringSoon(expiresAt: string | null): boolean {
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
  let refreshed: ExchangedTokens;
  try {
    refreshed = await exchangeRefreshToken(oauth, tokens.refreshToken);
  } catch (cause) {
    await markExpired(
      serviceClient,
      companyId,
      connectionId,
      cause instanceof Error ? cause.message : "The connection was rejected."
    );
    throw new ConnectionRevokedError(connectionId);
  }

  try {
    await writeTokens(serviceClient, companyId, connectionId, {
      accessToken: refreshed.accessToken,
      // Google omits the refresh token on a refresh response; keep the stored one.
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken
    });

    await serviceClient
      .from("integrationConnection")
      .update({
        expiresAt: refreshed.expiresAt,
        refreshingAt: null,
        status: "Active",
        lastError: null
      })
      .eq("companyId", companyId)
      .eq("id", connectionId);
  } catch (cause) {
    // The token itself is fine — storing it was not. Release the claim so the next
    // attempt can retry immediately rather than waiting out a phantom refresh.
    await releaseClaim(serviceClient, companyId, connectionId);
    throw cause;
  }

  return {
    accessToken: refreshed.accessToken,
    connection: { ...connection, expiresAt: refreshed.expiresAt }
  };
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

/** Drop a refresh claim without touching status — the connection may still be fine. */
async function releaseClaim(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
): Promise<void> {
  await serviceClient
    .from("integrationConnection")
    .update({ refreshingAt: null })
    .eq("companyId", companyId)
    .eq("id", connectionId);
}

async function markExpired(
  serviceClient: SupabaseClient<Database>,
  companyId: string,
  connectionId: string,
  lastError: string
): Promise<void> {
  await serviceClient
    .from("integrationConnection")
    .update({ status: "Expired", lastError, refreshingAt: null })
    .eq("companyId", companyId)
    .eq("id", connectionId);
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string | null;
}

/**
 * The one token-endpoint call. Server-side only — `client_secret` must never reach
 * the browser.
 *
 * The OAuth callback matches on this rejection message to pick its error code, so
 * the string is a contract between two files and is written here once.
 */
async function postTokenRequest(
  tokenUrl: string,
  body: Record<string, string>
): Promise<ExchangedTokens> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });

  if (!response.ok) {
    throw new Error(`The connection was rejected (${response.status}).`);
  }
  return readTokenResponse(await response.json());
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
  };
  if (typeof body.access_token !== "string") {
    throw new Error("The connection returned no access token.");
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt:
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : null
  };
}
