import { hashOAuthSecret } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

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

const clientRegistrationSchema = z.object({
  client_name: z.string().min(1),
  redirect_uris: z.array(z.string().url()).min(1),
  grant_types: z
    .array(z.string())
    .optional()
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.string()).optional().default(["code"]),
  token_endpoint_auth_method: z
    .enum(["client_secret_post", "client_secret_basic", "none"])
    .optional()
    .default("none"),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  scope: z.string().optional()
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

export async function action({ request }: ActionFunctionArgs) {
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
    logo_uri,
    scope
  } = validation.data;

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
    console.error(
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
