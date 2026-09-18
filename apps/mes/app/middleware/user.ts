import { requirePermissions } from "@carbon/auth/auth.server";
import type { MiddlewareFunction } from "react-router";
import { redirect } from "react-router";
import { userContext } from "~/context";
import { getConsolePinIn } from "~/services/console.server";
import { getLocation, setLocation } from "~/services/location.server";

export const userMiddleware: MiddlewareFunction = async ({
  context,
  request
}) => {
  const { client, companyId, userId, consoleMode } = await requirePermissions(
    request,
    {}
  );
  const { location, updated } = await getLocation(request, client, {
    companyId,
    userId
  });

  // Read pin-in state from cookies (console mode comes from auth session)
  const pinIn = consoleMode ? getConsolePinIn(request, companyId) : null;

  context.set(userContext, {
    locationId: location,
    companyId,
    consoleMode,
    effectiveUserId: pinIn?.userId ?? userId,
    pinnedInUser: pinIn
      ? { userId: pinIn.userId, name: pinIn.name, avatarUrl: pinIn.avatarUrl }
      : null
  });

  if (updated) {
    // Redirect back to the originally-requested URL (not the root) so deep
    // links survive the one-time location-cookie bootstrap. The re-run finds
    // the cookie set, so `updated` is false the second time through.
    //
    // RELATIVE, never `request.url`: behind a reverse proxy (portless locally,
    // any load balancer in production) `request.url` is the server's internal
    // origin (`http://127.0.0.1:<port>`). An absolute Location sent the
    // browser there on the first visit, off the public domain its session
    // cookie is scoped to — landing on a login page at 127.0.0.1. A relative
    // Location resolves against whatever origin the browser is actually on.
    const { pathname, search } = new URL(request.url);
    return redirect(`${pathname}${search}`, {
      headers: {
        "Set-Cookie": setLocation(companyId, location)
      }
    });
  }
};
