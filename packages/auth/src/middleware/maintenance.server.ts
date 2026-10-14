// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MAINTENANCE_MODE } from "@carbon/env";
import { data, type MiddlewareFunction } from "react-router";

const RETRY_AFTER_SECONDS = "300";

/**
 * What a request gets while the deployment is in maintenance: `null` lets it
 * through, a `Response` is returned as is, and `"refuse"` is the 503.
 *
 * `/health` answers 200 without probing anything. The load balancer and the
 * Swarm healthcheck replace a task that fails it, and the usual probe fails
 * while the database is down for the maintenance itself.
 */
export function maintenanceVerdict(
  enabled: boolean,
  pathname: string
): null | "healthy" | "refuse" {
  if (!enabled) return null;
  return pathname === "/health" ? "healthy" : "refuse";
}

/**
 * Root middleware for every app. With `MAINTENANCE_MODE` on, a page request
 * renders the root ErrorBoundary's 503 screen, an open tab's next navigation
 * does the same, and a resource route (API, webhooks, Inngest) answers a bare
 * 503 so the caller retries.
 */
export const maintenanceMiddleware: MiddlewareFunction<Response> = async (
  { request },
  next
) => {
  const verdict = maintenanceVerdict(
    MAINTENANCE_MODE,
    new URL(request.url).pathname
  );
  if (verdict === null) return next();
  if (verdict === "healthy") return Response.json({ status: "maintenance" });
  throw data(
    { message: "maintenance" },
    { status: 503, headers: { "Retry-After": RETRY_AFTER_SECONDS } }
  );
};
