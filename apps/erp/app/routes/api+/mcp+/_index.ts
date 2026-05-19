import { requirePermissions } from "@carbon/auth/auth.server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ActionFunctionArgs } from "react-router";
import { ensureMcpToolsLoaded } from "~/services/mcp/bootstrap.server";
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

  // Auth identity is established by `authContextMiddleware` (root) before
  // this resource-route action runs — verified that RR root middleware runs
  // for resource routes. The `Authorization: Bearer` → `carbon-key`
  // normalization now lives in `resolveApiKey`/`resolveAuthContext` (issue
  // #4), so it is already applied. requirePermissions here only builds the
  // RLS client (identity comes from the ALS scope, single-sourced).
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {});
  if (isMcpDebug) {
    console.log("[MCP] Auth successful:", { companyId, userId });
  }

  // Idempotent per cold-start: imports annotated service files so their
  // mcpTool() calls populate McpToolRegistry. Awaited so the registry is
  // ready before search_tools / describe_tool / call_tool run.
  await ensureMcpToolsLoaded();

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
