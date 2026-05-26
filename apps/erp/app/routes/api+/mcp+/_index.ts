import { requirePermissions } from "@carbon/auth/auth.server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ActionFunctionArgs } from "react-router";
import { createMcpServer } from "./lib/server";

const isMcpDebug =
  process.env.NODE_ENV !== "production" || process.env.MCP_DEBUG === "1";

export async function action({ request }: ActionFunctionArgs) {
  if (isMcpDebug) {
    // Redact credential-bearing headers before logging.
    const redactedHeaders: Record<string, string> = {};
    for (const [k, v] of request.headers.entries()) {
      const lower = k.toLowerCase();
      redactedHeaders[k] =
        lower === "authorization" ||
        lower === "carbon-key" ||
        lower === "cookie"
          ? "[redacted]"
          : v;
    }
    console.log("[MCP] Received request:", {
      method: request.method,
      url: request.url,
      headers: redactedHeaders
    });
  }

  // This resource route has no `x+/_layout` parent so `authContextMiddleware`
  // does not run for it. `requirePermissions` falls back to
  // `resolveAuthContext(request)` (Bearer → carbon-key normalization included)
  // when `AuthContextHolder.tryGet()` is empty, so identity is still
  // single-sourced via the same code path.
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {});
  if (isMcpDebug) {
    console.log("[MCP] Auth successful:", { companyId, userId });
  }

  const server = createMcpServer({ client, companyId, companyGroupId, userId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  await server.connect(transport);
  if (isMcpDebug) {
    console.log("[MCP] Server connected");
  }

  const response = await transport.handleRequest(request);
  if (isMcpDebug) {
    console.log("[MCP] Response status:", response.status);
  }
  return response;
}

export async function loader() {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null
    }),
    {
      status: 405,
      headers: { "Content-Type": "application/json" }
    }
  );
}
