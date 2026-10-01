// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/env";
import { getRequestOrigin } from "@carbon/utils";
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
  const origin =
    getAppUrl() || getRequestOrigin(request) || new URL(request.url).origin;

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
