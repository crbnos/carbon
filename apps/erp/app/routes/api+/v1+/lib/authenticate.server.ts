// Resolve an incoming Carbon API v1 request to an AuthedContext.
//
// v1 accepts API keys only, sent as `Authorization: Bearer crbn_…` (the convention the
// rest.carbon.ms proxy uses) or the raw `carbon-key` header. Client + rate limit + plan
// gate + expiry are handled by reusing the carbon-key branch of requirePermissions; the
// per-operation scope gate lives in oRPC middleware and reads the scopes we attach here.

import {
  getCompanyIdFromAPIKey,
  requirePermissions
} from "@carbon/auth/auth.server";
import type { AuthedContext } from "./base.server";

/**
 * Authenticate a raw API key into an AuthedContext. Shared by the v1 HTTP
 * transport and the MCP endpoint's carbon-key branch, so the
 * requirePermissions-then-read-scopes dance exists once.
 *
 * requirePermissions' carbon-key branch reads the `carbon-key` header, so the key
 * is presented that way regardless of how the caller sent it. Empty
 * required-permissions: the per-operation scope check lives in oRPC middleware.
 * The scope read hits the same 30s cache requirePermissions just warmed — a Redis
 * hit, not a second apiKey select.
 */
export async function authedContextFromApiKey(
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

  return authedContextFromApiKey(request.url, rawKey);
}
