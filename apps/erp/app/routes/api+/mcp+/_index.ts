import { hashOAuthSecret, requirePermissions } from "@carbon/auth/auth.server";
import {
  getCarbonServiceRole,
  getUserScopedClient
} from "@carbon/auth/client.server";
import { getAppUrl } from "@carbon/env";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { createMcpServer } from "./lib/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

type McpContext = {
  client: SupabaseClient;
  companyId: string;
  companyGroupId: string;
  userId: string;
};

async function authenticateOAuthToken(
  accessToken: string
): Promise<{ userId: string; companyId: string } | null> {
  const serviceRole = getCarbonServiceRole();
  const tokenResult = await serviceRole
    .from("oauthToken")
    .select("userId, companyId, expiresAt")
    .eq("accessToken", hashOAuthSecret(accessToken))
    .single();

  if (!tokenResult.data) return null;
  if (new Date(tokenResult.data.expiresAt) < new Date()) return null;

  return {
    userId: tokenResult.data.userId,
    companyId: tokenResult.data.companyId
  };
}

function make401Response(request: Request): Response {
  const origin = getAppUrl() || new URL(request.url).origin;
  return new Response(null, {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      ...corsHeaders
    }
  });
}

async function resolveAuth(request: Request): Promise<{
  ctx: McpContext;
  request: Request;
}> {
  const authHeader = request.headers.get("Authorization");
  const hasCarbonKey = request.headers.has("carbon-key");

  if (authHeader?.startsWith("Bearer ") && !hasCarbonKey) {
    const token = authHeader.slice(7);

    // Try OAuth for non-API-key tokens
    if (!token.startsWith("crbn_")) {
      const oauthAuth = await authenticateOAuthToken(token);
      if (oauthAuth) {
        const client = await getUserScopedClient(oauthAuth.userId);
        const companyResult = await client
          .from("company")
          .select("companyGroupId")
          .eq("id", oauthAuth.companyId)
          .single();

        return {
          ctx: {
            client,
            companyId: oauthAuth.companyId,
            companyGroupId:
              companyResult.data?.companyGroupId ?? oauthAuth.companyId,
            userId: oauthAuth.userId
          },
          request
        };
      }

      throw make401Response(request);
    }

    // Fall back to carbon-key auth
    const headers = new Headers(request.headers);
    headers.set("carbon-key", token);
    request = new Request(request, { headers });
  }

  // No Authorization header at all — return 401 for OAuth discovery
  if (!authHeader && !hasCarbonKey) {
    throw make401Response(request);
  }

  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {});

  return {
    ctx: { client, companyId, companyGroupId, userId },
    request
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { ctx, request: authedRequest } = await resolveAuth(request);

  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  await server.connect(transport);
  const response = await transport.handleRequest(authedRequest);

  return addCorsHeaders(response);
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null
    }),
    {
      status: 405,
      headers: corsHeaders
    }
  );
}
