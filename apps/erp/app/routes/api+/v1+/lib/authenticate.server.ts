// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Resolve an incoming Carbon API request to an AuthedContext.
//
// v1 accepts API keys only, sent as `Authorization: Bearer crbn_…` (the convention the
// rest.carbon.ms proxy uses) or the raw `carbon-key` header. Client + rate limit + plan
// gate + expiry are handled by reusing the carbon-key branch of requirePermissions; the
// per-operation check is the service function's gate, which reads the scopes we attach here.
// The MCP endpoint also accepts an OAuth connector token (`authenticateOAuthToken`).

import {
  getCompanyIdFromAPIKey,
  hashOAuthSecret,
  requirePermissions
} from "@carbon/auth/auth.server";
import {
  getCarbonServiceRole,
  getUserScopedClient
} from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { getLogger } from "@carbon/logger";
import { type AuthedContext, scopesFromPermissions } from "./base.server";

const logger = getLogger("erp", "api", "authenticate");

/**
 * Authenticate a raw API key into an AuthedContext. Shared by the v1 HTTP
 * transport and the MCP endpoint's carbon-key branch, so the
 * requirePermissions-then-read-scopes dance exists once.
 *
 * requirePermissions' carbon-key branch reads the `carbon-key` header, so the key
 * is presented that way regardless of how the caller sent it. Empty
 * required-permissions: each operation's service function checks the key's
 * scopes in its own gate.
 * The scope read hits the same 30s cache requirePermissions just warmed — a Redis
 * hit, not a second apiKey select.
 */
export async function authenticateApiKey(
  url: string,
  rawKey: string
): Promise<AuthedContext> {
  const authHeaders = new Headers();
  authHeaders.set("carbon-key", rawKey);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(new Request(url, { headers: authHeaders }), {});

  const { data: keyRow } = await getCompanyIdFromAPIKey(rawKey);

  return {
    client,
    companyId,
    companyGroupId,
    userId,
    authKind: "api-key",
    scopes: keyRow?.scopes ?? {}
  };
}

export async function resolveApiKeyContext(
  request: Request
): Promise<AuthedContext> {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^bearer\s+/i.test(authorization)
    ? authorization.replace(/^bearer\s+/i, "").trim()
    : "";
  const rawKey = request.headers.get("carbon-key")?.trim() || bearer;

  if (!rawKey) {
    throw new Response(
      "Unauthorized: send your API key as `Authorization: Bearer crbn_…`.",
      { status: 401 }
    );
  }
  if (!rawKey.startsWith("crbn_")) {
    throw new Response(
      "The Carbon API v1 accepts API keys only. Use the MCP endpoint for OAuth connectors.",
      { status: 401 }
    );
  }

  return authenticateApiKey(request.url, rawKey);
}

/** Who an OAuth access token was issued to, and for which company. */
export type OAuthIdentity = { userId: string; companyId: string };

/**
 * The identity behind an OAuth (MCP connector) access token, or null when the
 * token is unknown or expired. Only the token is read — the caller rate-limits
 * on the identity before `oauthContext` does the heavier work.
 */
export async function findOAuthToken(
  accessToken: string
): Promise<OAuthIdentity | null> {
  const token = await getCarbonServiceRole()
    .from("oauthToken")
    .select("userId, companyId, expiresAt")
    .eq("accessToken", hashOAuthSecret(accessToken))
    .maybeSingle();

  if (!token.data) return null;
  if (new Date(token.data.expiresAt) < new Date()) return null;
  return { userId: token.data.userId, companyId: token.data.companyId };
}

/**
 * The AuthedContext an OAuth token acts with, or null when its user may no
 * longer use it.
 *
 * A token carries no permissions of its own. It acts as its user does NOW in
 * the token's company: an employee there (a user removed from the company, or
 * turned into a customer/supplier portal account, loses the connector with it),
 * gated per operation on that user's live permissions.
 */
export async function oauthContext({
  userId,
  companyId
}: OAuthIdentity): Promise<AuthedContext | null> {
  const serviceRole = getCarbonServiceRole();
  const [membership, company, claims, client] = await Promise.all([
    serviceRole
      .from("userToCompany")
      .select("role")
      .eq("userId", userId)
      .eq("companyId", companyId)
      .maybeSingle(),
    serviceRole
      .from("company")
      .select("companyGroupId")
      .eq("id", companyId)
      .single(),
    getUserClaims(userId, companyId),
    getUserScopedClient(userId)
  ]);

  if (membership.data?.role !== "employee") return null;
  if (!company.data) {
    logger.error("Failed to read the OAuth token's company", {
      companyId,
      userId,
      error: company.error
    });
    throw new Error(`Failed to read company ${companyId} for an OAuth token`);
  }

  return {
    client,
    companyId,
    // A company with no group carries "", as a session does.
    companyGroupId: company.data.companyGroupId ?? "",
    userId,
    authKind: "oauth",
    scopes: scopesFromPermissions(claims.permissions, companyId)
  };
}
