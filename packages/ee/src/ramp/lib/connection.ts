import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveIntegrationSecrets } from "../../integrations/secrets";
import { buildRampIdempotencyKey, RampClient } from "./client";
import {
  RampAccountingConnectionSchema,
  type RampCredentials,
  type RampCursors,
  type RampIntegrationMetadata,
  RampIntegrationMetadataSchema
} from "./models";
import {
  clearRampConnectionState,
  patchRampConnection,
  patchRampCursor,
  patchRampRefreshedTokens
} from "./state";

/**
 * Server-only Ramp connection and authentication state. Every entry point takes
 * a SERVICE-ROLE Supabase client plus a company id, resolves vaulted metadata,
 * and constructs a refresh-capable {@link RampClient}.
 *
 * This module is server-only (it reaches the vault + a privileged client) and is
 * exported via `@carbon/ee/ramp.server` — never import it from `config.tsx`.
 */

export const RAMP = "ramp";

// /********************************************************\
// *                 Metadata read/write                   *
// \********************************************************/

/**
 * Read the RAW stored (secret-free) metadata for the company's Ramp integration.
 * Returns `null` when the integration is not installed or not active.
 */
export async function readStoredRampMetadata(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRole
    .from("companyIntegration")
    .select("metadata, active")
    .eq("id", RAMP)
    .eq("companyId", companyId)
    .maybeSingle();

  if (error || !data || !data.active) return null;
  return (data.metadata as Record<string, unknown> | null) ?? {};
}

/**
 * Advance a single Ramp sync cursor (`metadata.cursors.<key>`) without reading
 * or replacing any sibling state.
 */
export async function advanceRampCursor(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  key: keyof NonNullable<RampCursors>,
  value: string
): Promise<void> {
  await patchRampCursor(serviceRole, companyId, key, value);
}

/**
 * Clear the stored `webhookId`, `connectionId`, and paired vaulted webhook
 * secret. Called on uninstall so a later reinstall re-creates them at Ramp
 * instead of trusting state that no longer exists there. Leaves every other
 * sibling key (cursors, account-mapping config, OAuth secrets) untouched.
 */
export async function clearRampConnectionMetadata(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<void> {
  await clearRampConnectionState(serviceRole, companyId);
}

// /********************************************************\
// *                     Connection                        *
// \********************************************************/

/**
 * Build a {@link RampClient} wired for OAuth2 token refresh: it carries Carbon's
 * OAuth app credentials (from env, needed to run the `refresh_token` grant) and
 * an `onTokensRefreshed` hook that persists a refreshed oauth2 access token back
 * to the vault. Shared by every caller that constructs a client so none of them
 * builds one that cannot refresh an expired oauth2 token.
 */
export function buildRampClient(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  credentials: RampCredentials
): RampClient {
  // Carbon's OAuth app — read lazily from process.env (importing @carbon/env
  // here would eagerly validate unrelated required vars and break server-only
  // tests).
  const rampClientId = process.env.RAMP_CLIENT_ID;
  const rampClientSecret = process.env.RAMP_CLIENT_SECRET;
  const oauthApp =
    rampClientId && rampClientSecret
      ? { clientId: rampClientId, clientSecret: rampClientSecret }
      : undefined;

  return new RampClient(credentials, {
    oauthApp,
    // Only oauth2 connections refresh; client-credentials mint fresh tokens.
    onTokensRefreshed:
      credentials.type === "oauth2"
        ? (tokens) => persistRefreshedRampTokens(serviceRole, companyId, tokens)
        : undefined
  });
}

/**
 * Persist a refreshed oauth2 access token + expiry through the atomic path
 * patch. Ramp does not rotate the refresh token, so it is left untouched.
 */
async function persistRefreshedRampTokens(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  tokens: { accessToken: string; expiresAt: string }
): Promise<void> {
  await patchRampRefreshedTokens(serviceRole, companyId, tokens);
}

/**
 * Load the company's Ramp integration — a ready {@link RampClient} plus parsed
 * metadata (vaulted secrets resolved). Returns `null` when Ramp is not
 * installed/active or the metadata does not parse.
 */
export async function getRampIntegration(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ client: RampClient; metadata: RampIntegrationMetadata } | null> {
  const stored = await readStoredRampMetadata(serviceRole, companyId);
  if (!stored) return null;

  const resolved = await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    RAMP,
    stored
  );

  const parsed = RampIntegrationMetadataSchema.safeParse(resolved);
  if (!parsed.success) return null;

  const client = buildRampClient(
    serviceRole,
    companyId,
    parsed.data.credentials
  );

  return { client, metadata: parsed.data };
}

/**
 * Exchange an OAuth authorization code (the Connect-flow callback) for oauth2
 * credentials, using Carbon's registered Ramp OAuth app. OAuth is the production
 * flow, so the returned credentials are pinned to `environment: "production"`.
 * The caller stores these via the atomic Ramp OAuth patch (which vaults the
 * access + refresh tokens) and then runs `rampOnInstall`.
 */
export async function exchangeRampOAuthCode(
  code: string,
  redirectUri: string
): Promise<Extract<RampCredentials, { type: "oauth2" }>> {
  const clientId = process.env.RAMP_CLIENT_ID;
  const clientSecret = process.env.RAMP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Ramp OAuth is not configured (set RAMP_CLIENT_ID / RAMP_CLIENT_SECRET)"
    );
  }
  // A placeholder access token just to construct the client; the exchange only
  // uses the OAuth app credentials + host (production).
  const client = new RampClient(
    { type: "oauth2", accessToken: "", environment: "production" },
    { oauthApp: { clientId, clientSecret } }
  );
  const tokens = await client.exchangeAuthorizationCode(code, redirectUri);
  return {
    type: "oauth2",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    environment: "production"
  };
}

/**
 * Ensure a Ramp accounting connection exists for the company. Creates one with
 * `remote_provider_name: "Carbon"` when `metadata.connectionId` is unset and
 * stores the returned id back into the (secret-free) metadata column.
 */
export async function ensureRampConnection(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ connectionId: string } | null> {
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return null;

  const { client, metadata } = integration;
  if (metadata.connectionId) return { connectionId: metadata.connectionId };

  const connection = RampAccountingConnectionSchema.parse(
    await client.createAccountingConnection(
      { remote_provider_name: "Carbon" },
      // Entity-scoped idempotency key — one accounting connection per company, so
      // a retried install cannot create a second one at Ramp.
      buildRampIdempotencyKey({
        companyId,
        operation: "createAccountingConnection",
        scope: companyId
      })
    )
  );
  const connectionId = connection.connection_id ?? connection.id;
  if (!connectionId) {
    throw new Error("Ramp did not return a connection id");
  }

  await patchRampConnection(serviceRole, companyId, connectionId);

  return { connectionId };
}
