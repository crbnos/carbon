// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveIntegrationSecrets } from "../../integrations/secrets";
import { RAMP_ENVIRONMENT } from "../environment";
import { buildRampIdempotencyKey, RampClient } from "./client";
import {
  CARBON_PROVIDER_NAME,
  isCarbonConnection,
  linkedConnections,
  type RampConnection,
  RampSeatConflictError
} from "./connection-status";
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

const logger = getLogger("ee", "ramp");

// /********************************************************\
// *                 Metadata read/write                   *
// \********************************************************/

/**
 * Read the RAW stored (secret-free) metadata for the company's Ramp integration.
 * Returns `null` when the integration is not installed or not active.
 */
/**
 * `includeInactive` exists for TEARDOWN only.
 *
 * The uninstall route deactivates the row BEFORE calling `onUninstall`, so a
 * read that requires `active` returns null inside the very hook whose job is to
 * tear down the remote side — which silently made `rampOnUninstall`'s webhook and
 * accounting-connection deletes dead code, leaving both alive at Ramp forever
 * (found during the push-only verification, 2026-09-25). An orphaned connection
 * keeps holding Ramp's single accounting seat, which is the exact failure
 * push-only mode exists to prevent.
 *
 * Every other caller must keep the default: an inactive integration must not
 * sync, push, or report health.
 */
export type RampMetadataReadOptions = { includeInactive?: boolean };

export async function readStoredRampMetadata(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  options: RampMetadataReadOptions = {}
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceRole
    .from("companyIntegration")
    .select("metadata, active")
    .eq("id", RAMP)
    .eq("companyId", companyId)
    .maybeSingle();

  if (error || !data) return null;
  if (!data.active && !options.includeInactive) return null;
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
  companyId: string,
  options: RampMetadataReadOptions = {}
): Promise<{ client: RampClient; metadata: RampIntegrationMetadata } | null> {
  const stored = await readStoredRampMetadata(serviceRole, companyId, options);
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
 * credentials, using Carbon's registered Ramp OAuth app. The returned
 * credentials are stamped with `RAMP_ENVIRONMENT` (the TEMPORARY sandbox/
 * production switch in `../environment`) so every subsequent Ramp API call and
 * token refresh hits the matching host. The caller stores these via the atomic
 * Ramp OAuth patch (which vaults the access + refresh tokens) and then runs
 * `rampOnInstall`.
 */
export async function exchangeRampOAuthCode(
  code: string,
  redirectUri: string
): Promise<{
  credentials: Extract<RampCredentials, { type: "oauth2" }>;
  /**
   * The scopes the token response ACTUALLY returned, when it said.
   *
   * RFC 6749 §3.3 lets an authorization server issue NARROWER scope than
   * requested, and requires it to include `scope` when it does. So the requested
   * list is an intention and this is the fact — recording the intention would
   * make the UI claim capabilities the grant may not carry. Undefined when the
   * response omitted it (which, per §3.3, means "as requested").
   */
  grantedScopes?: string[];
}> {
  const clientId = process.env.RAMP_CLIENT_ID;
  const clientSecret = process.env.RAMP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Ramp OAuth is not configured (set RAMP_CLIENT_ID / RAMP_CLIENT_SECRET)"
    );
  }
  // A placeholder access token just to construct the client; the exchange uses
  // the OAuth app credentials + the environment's host (the token POST goes to
  // `${host}/developer/v1/token`, so the environment must be set here too).
  const client = new RampClient(
    { type: "oauth2", accessToken: "", environment: RAMP_ENVIRONMENT },
    { oauthApp: { clientId, clientSecret } }
  );
  const tokens = await client.exchangeAuthorizationCode(code, redirectUri);
  return {
    credentials: {
      type: "oauth2",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      environment: RAMP_ENVIRONMENT
    },
    grantedScopes: tokens.scope?.split(" ").filter(Boolean)
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

  /**
   * Ramp permits exactly ONE accounting connection, and `POST /accounting/connection`
   * RETURNS THE INCUMBENT rather than refusing when one already exists — verified
   * live 2026-09-26, where a provider-mode install against a business whose seat
   * was held by another system stored that system's connection id as its own.
   *
   * Carbon then believed it held the seat: it would push the chart of accounts,
   * cost centers and projects into someone else's connection, confirm syncs
   * against it, show a green healthcheck — and on uninstall DELETE it, which is
   * the "worst possible uninstall side effect" this file already warns about.
   *
   * So look before creating. An incumbent that is not Carbon's is a refusal with
   * an actionable message, not something to adopt.
   */
  let existing: RampConnection[] = [];
  try {
    existing = linkedConnections(await client.getAccountingConnections());
  } catch (err) {
    // Unreadable: fall through to the create, whose response is checked below.
    // A transient read failure must not block an otherwise valid install.
    //
    // But SAY so. This read IS the seat-conflict guard — without it the install
    // proceeds behind only the weaker check on the create's response, and the
    // failure mode it exists to prevent (adopting, then on uninstall DELETING,
    // another system's accounting connection) has no other trace. A silent
    // catch made "the strong check was skipped" unobservable.
    logger.warning(
      "Could not read Ramp accounting connections — creating without the seat-conflict check",
      { companyId, error: err instanceof Error ? err.message : String(err) }
    );
  }

  const incumbent = existing.find(
    (connection) => !isCarbonConnection(connection)
  );
  const ownExisting = existing.find(isCarbonConnection);

  if (ownExisting?.id) {
    // Carbon's own connection already exists — adopt it. This is the documented
    // re-install / fresh-database case that previously needed a manual metadata
    // edit to recover from.
    await patchRampConnection(serviceRole, companyId, ownExisting.id);
    return { connectionId: ownExisting.id };
  }

  if (incumbent) {
    throw new RampSeatConflictError(
      incumbent.remote_provider_name ?? undefined
    );
  }

  const connection = RampAccountingConnectionSchema.parse(
    await client.createAccountingConnection(
      { remote_provider_name: CARBON_PROVIDER_NAME },
      // Entity-scoped idempotency key — one accounting connection per company, so
      // a retried install cannot create a second one at Ramp.
      buildRampIdempotencyKey({
        companyId,
        operation: "createAccountingConnection",
        scope: companyId
      })
    )
  );

  // The create can still hand back an incumbent the read above missed (it may
  // have failed, or the seat may have been taken in between). Storing an id
  // without checking whose it is is the whole bug.
  if (
    connection.remote_provider_name &&
    !isCarbonConnection(connection as RampConnection)
  ) {
    throw new RampSeatConflictError(connection.remote_provider_name);
  }

  const connectionId = connection.connection_id ?? connection.id;
  if (!connectionId) {
    throw new Error("Ramp did not return a connection id");
  }

  await patchRampConnection(serviceRole, companyId, connectionId);

  return { connectionId };
}
