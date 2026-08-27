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

export async function listConnections(
  client: SupabaseClient<Database>,
  companyId: string,
  pieceName?: string
) {
  let query = client
    .from("integrationConnection")
    .select(SELECT_COLUMNS)
    .eq("companyId", companyId);
  if (pieceName !== undefined) query = query.eq("pieceName", pieceName);
  return query.order("createdAt", { ascending: true });
}

export async function getConnection(
  client: SupabaseClient<Database>,
  companyId: string,
  connectionId: string
) {
  return client
    .from("integrationConnection")
    .select(SELECT_COLUMNS)
    .eq("companyId", companyId)
    .eq("id", connectionId)
    .maybeSingle();
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

  const { data } = await serviceClient
    .from("integrationConnection")
    .update({ refreshingAt: now.toISOString() })
    .eq("companyId", companyId)
    .eq("id", connectionId)
    .or(`refreshingAt.is.null,refreshingAt.lt.${staleBefore}`)
    .select("id");

  return Array.isArray(data) && data.length > 0;
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
  const { data: row, error } = await getConnection(
    serviceClient,
    companyId,
    connectionId
  );
  if (error || row === null) {
    throw new ConnectionRevokedError(connectionId);
  }
  const connection = row as unknown as IntegrationConnection;
  if (connection.status !== "Active") {
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

  const refreshed = await exchangeRefreshToken(
    oauth,
    tokens.refreshToken
  ).catch(async (cause: unknown) => {
    await markExpired(
      serviceClient,
      companyId,
      connectionId,
      cause instanceof Error ? cause.message : "The connection was rejected."
    );
    throw new ConnectionRevokedError(connectionId);
  });

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
    const { data } = await getConnection(
      serviceClient,
      companyId,
      connectionId
    );
    const current = data as unknown as IntegrationConnection | null;
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

/** Server-side only — `client_secret` must never reach the browser. */
export async function exchangeRefreshToken(
  oauth: OAuth2RefreshConfig,
  refreshToken: string
): Promise<ExchangedTokens> {
  const response = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret
    })
  });

  if (!response.ok) {
    throw new Error(`The connection was rejected (${response.status}).`);
  }
  return readTokenResponse(await response.json());
}

/** Server-side only. Swaps an authorization code for the first token pair. */
export async function exchangeAuthorizationCode(
  oauth: OAuth2RefreshConfig & { redirectUri: string },
  code: string
): Promise<ExchangedTokens> {
  const response = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      redirect_uri: oauth.redirectUri
    })
  });

  if (!response.ok) {
    throw new Error(`The connection was rejected (${response.status}).`);
  }
  return readTokenResponse(await response.json());
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
