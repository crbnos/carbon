import { getAppUrl } from "@carbon/env";
import type { LoaderFunctionArgs } from "react-router";
import { buildMcpManifest } from "./api+/mcp+/lib/manifest";

/**
 * The MCP server manifest, at the well-known path a client or registry probes.
 *
 * Public and unauthenticated by design: it carries no company data, only how to
 * reach `/api/mcp` and how to authenticate against it. CORS is open because
 * browser-based agents fetch it cross-origin, and a CORS error there reads to
 * the agent as "no manifest exists".
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const origin = getAppUrl() || url.origin;

  return new Response(JSON.stringify(buildMcpManifest(origin), null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
