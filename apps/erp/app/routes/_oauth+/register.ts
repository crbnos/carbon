// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hashOAuthSecret } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { getClientIp } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { isAllowedRedirectUri, supportedScope } from "~/services/oauth.server";

const logger = getLogger("erp", "register");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function jsonResponse(body: unknown, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

// Registration is open by design — MCP clients (Claude, Cursor, VS Code) register
// themselves on first connect, with no account to authenticate. So the limit is
// per IP and generous: a connector platform registers from a few egress IPs.
const REGISTRATIONS_PER_HOUR = 100;

const clientRegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z
    .array(
      z.string().max(2000).refine(isAllowedRedirectUri, {
        message:
          "redirect_uris must be https, http on a loopback address, or a private-use scheme, with no fragment"
      })
    )
    .min(1)
    .max(10),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .optional()
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).optional().default(["code"]),
  // What `/.well-known/oauth-authorization-server` advertises: `/token` reads
  // the secret from the form body only, so a `client_secret_basic` client
  // could register and then never authenticate.
  token_endpoint_auth_method: z
    .enum(["client_secret_post", "none"])
    .optional()
    .default("none"),
  client_uri: z.string().url().max(2000).optional(),
  logo_uri: z.string().url().max(2000).optional(),
  scope: z.string().max(500).optional()
});

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return jsonResponse(
    { error: "method_not_allowed", error_description: "Use POST" },
    405
  );
}

const registerRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(REGISTRATIONS_PER_HOUR, "1 h")
});

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request) ?? "unknown";
  const rl = await registerRatelimit.limit(`oauth-register:${ip}`);
  if (!rl.success) {
    return jsonResponse(
      {
        error: "too_many_requests",
        error_description: "Too many client registrations. Try again later."
      },
      429
    );
  }

  const client = getCarbonServiceRole();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_request", error_description: "Invalid JSON body" },
      400
    );
  }

  const validation = clientRegistrationSchema.safeParse(body);
  if (!validation.success) {
    return jsonResponse(
      {
        error: "invalid_client_metadata",
        error_description: validation.error.issues
          .map((i) => i.message)
          .join(", ")
      },
      400
    );
  }

  const {
    client_name,
    redirect_uris,
    grant_types,
    response_types,
    token_endpoint_auth_method,
    client_uri,
    logo_uri
  } = validation.data;
  const scope = supportedScope(validation.data.scope);

  // Generate client credentials
  const clientId = `mcp_${crypto.randomUUID().replace(/-/g, "")}`;
  const rawClientSecret =
    token_endpoint_auth_method !== "none" ? crypto.randomUUID() : null;

  const insertResult = await client.from("oauthClient").insert([
    {
      clientId,
      clientSecret: rawClientSecret ? hashOAuthSecret(rawClientSecret) : null,
      name: client_name,
      redirectUris: redirect_uris,
      grantTypes: grant_types,
      responseTypes: response_types,
      tokenEndpointAuthMethod: token_endpoint_auth_method,
      clientUri: client_uri || null,
      logoUri: logo_uri || null,
      scope: scope || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);

  if (insertResult.error) {
    logger.error(
      "[OAuth Register] Failed to create client:",
      insertResult.error
    );
    return jsonResponse(
      { error: "server_error", error_description: "Failed to register client" },
      500
    );
  }

  const response: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name,
    redirect_uris,
    grant_types,
    response_types,
    token_endpoint_auth_method
  };

  if (rawClientSecret) {
    response.client_secret = rawClientSecret;
    response.client_secret_expires_at = 0;
  }

  if (client_uri) response.client_uri = client_uri;
  if (logo_uri) response.logo_uri = logo_uri;
  if (scope) response.scope = scope;

  return jsonResponse(response, 201);
}
