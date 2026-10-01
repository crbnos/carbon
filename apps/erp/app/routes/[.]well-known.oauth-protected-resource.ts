// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/env";
import { getRequestOrigin } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const origin =
    getAppUrl() || getRequestOrigin(request) || new URL(request.url).origin;

  return new Response(
    JSON.stringify({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools"]
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, max-age=3600"
      }
    }
  );
}
