import { hashOAuthSecret } from "@carbon/auth/auth.server";
import {
  getCarbonServiceRole,
  getUserScopedClient
} from "@carbon/auth/client.server";
import { getAppUrl } from "@carbon/env";
import { Ratelimit, redis } from "@carbon/kv";
import { withLogContext } from "@carbon/logger/middleware.server";
import { datetime } from "@carbon/utils";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ActionFunctionArgs } from "react-router";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { authenticateApiKey } from "../v1+/lib/authenticate.server";
import { createMcpServer } from "./lib/server";
import type { McpContext } from "./lib/types";

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

/**
 * OAuth (connector) callers get the same allowance an API key gets by default —
 * 60 requests/minute — but through the app's Redis limiter rather than the
 * Postgres one: `apiKeyRateLimit` has an FK to `apiKey`, so it cannot count a
 * synthetic per-user id, and this route only exists in the Node app where Redis
 * is the house tool (the login limiter is the precedent). Keyed by USER, not by
 * token, so minting extra tokens does not multiply the allowance. Without this,
 * the OAuth branch was the one authenticated path with no rate limit at all —
 * it never touches requirePermissions, where the API-key limit lives.
 */
const OAUTH_RATE_LIMIT = 60;
const oauthRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(OAUTH_RATE_LIMIT, "1 m")
});

function make429Response(reset: number, remaining: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: {
      "X-RateLimit-Limit": OAUTH_RATE_LIMIT.toString(),
      "X-RateLimit-Remaining": remaining.toString(),
      "X-RateLimit-Reset": reset.toString(),
      "Retry-After": retryAfterSeconds.toString(),
      ...corsHeaders
    }
  });
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
        const rl = await oauthRatelimit.limit(`mcp-oauth:${oauthAuth.userId}`);
        if (!rl.success) {
          throw make429Response(rl.reset, rl.remaining);
        }

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
            userId: oauthAuth.userId,
            authKind: "oauth" as const,
            scopes: {}
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

  // `request` here carries the carbon-key header for both entry forms
  // (`Bearer crbn_…` was rewritten above). Same helper as the v1 HTTP transport,
  // so the requirePermissions-then-read-scopes dance exists once.
  const rawKey = request.headers.get("carbon-key") ?? "";
  return {
    ctx: await authenticateApiKey(request.url, rawKey),
    request
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { ctx, request: authedRequest } = await resolveAuth(request);

  // Stamp the authenticated identity into the logging context so every log
  // line in this request carries it alongside the middleware's requestId.
  const response = await withLogContext(
    { companyId: ctx.companyId, userId: ctx.userId, authKind: ctx.authKind },
    async () => {
      // The agent is told what "today" is; it has to be the company's day, not
      // the server's, or every relative-date tool call it makes lands a day off.
      const server = createMcpServer(
        ctx,
        datetime
          .today(await getCompanyTimeZone(ctx.client, ctx.companyId))
          .toString()
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      await server.connect(transport);
      return transport.handleRequest(authedRequest);
    }
  );

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
