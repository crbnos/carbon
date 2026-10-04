// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect } from "react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { Button } from "../Button";

/**
 * The boundary for a route that renders inside the app shell:
 *
 *   export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react";
 *
 * A boundary replaces the route that exports it, so the root boundary takes the
 * whole page — sidebar and topbar included. Exported from a module layout, a
 * failed loader anywhere beneath it shows here and the shell stays usable.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  // React Router hands a route error to the boundary without logging it.
  useEffect(() => {
    // biome-ignore lint/suspicious/noConsole: surfacing the swallowed error is the point
    console.error("[RouteErrorBoundary]", error);
  }, [error]);

  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const status = isRouteErrorResponse(error) ? error.status : undefined;

  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-foreground">
          {notFound
            ? "This page could not be found"
            : "This page failed to load"}
        </h2>
        <p className="max-w-md text-sm text-muted-foreground text-balance">
          {notFound
            ? "It may have been moved or deleted, or it belongs to another company."
            : "Something went wrong on our side. Trying again usually fixes it."}
          {status && !notFound ? ` (${status})` : null}
        </p>
      </div>
      <div className="flex gap-2">
        {!notFound && (
          <Button variant="primary" onClick={() => navigate(0)}>
            Try again
          </Button>
        )}
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    </div>
  );
}
