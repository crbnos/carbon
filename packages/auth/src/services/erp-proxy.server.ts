// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/env";
import { getLogger } from "@carbon/logger";

const log = getLogger("auth", "erp-proxy");

/**
 * Forwards a request from another Carbon app (MES, starter) to the same path
 * on the ERP, with the user's cookies. The session cookie is scoped to the
 * parent domain, so the ERP reads the same session the app does. This is how
 * those apps use the ERP's API routes — the account settings modal reads and
 * writes through it — without a copy of each route.
 */
export async function proxyToErp(request: Request, path: string | undefined) {
  // Without the host header the ERP's server refuses the connection.
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  try {
    const response = await fetch(
      `${getAppUrl()}/${path ?? ""}${new URL(request.url).search}`,
      {
        method: request.method,
        body: hasBody ? request.body : undefined,
        headers,
        // Required when streaming a request body.
        ...(hasBody && { duplex: "half" })
      } as RequestInit
    );

    // fetch has already decompressed the body, so the ERP's encoding headers
    // no longer describe it.
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    log.error("Proxy request failed", { path, error });
    return new Response("Proxy request failed", { status: 500 });
  }
}
