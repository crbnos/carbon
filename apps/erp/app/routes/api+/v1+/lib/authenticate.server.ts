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

  // requirePermissions' carbon-key branch reads the `carbon-key` header, so present
  // the key that way. Empty required-permissions: the per-op scope check is separate.
  const authHeaders = new Headers();
  authHeaders.set("carbon-key", rawKey);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(
      new Request(request.url, { headers: authHeaders }),
      {}
    );

  const { data } = await getCompanyIdFromAPIKey(rawKey);
  const scopes =
    (data as { scopes?: Record<string, string[]> } | null)?.scopes ?? {};

  return {
    client,
    companyId,
    companyGroupId,
    userId,
    authKind: "api-key",
    scopes
  };
}
