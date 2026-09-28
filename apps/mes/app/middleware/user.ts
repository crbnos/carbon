import { requirePermissions } from "@carbon/auth/auth.server";
import {
  clearConsolePinIn,
  resolveConsolePinIn
} from "@carbon/auth/console-pin.server";
import { updateSessionConsole } from "@carbon/auth/session.server";
import { isConsoleModeEnabledForCompany } from "@carbon/ee/console.server";
import { getLogger } from "@carbon/logger";
import type { MiddlewareFunction } from "react-router";
import { redirect } from "react-router";
import { userContext } from "~/context";
import { getLocation, setLocation } from "~/services/location.server";
import { path } from "~/utils/path";

const log = getLogger("mes", "user-middleware");

// Only a GET/HEAD can be redirected back to its own URL: a POST's URL is
// usually an action-only resource route, and the browser would follow the
// redirect with a GET that has no loader to answer it.
const isRead = (request: Request) =>
  request.method === "GET" || request.method === "HEAD";

export const userMiddleware: MiddlewareFunction = async (
  { context, request },
  next
) => {
  const { client, companyId, userId, sessionUserId, consoleMode } =
    await requirePermissions(request, {});

  // The session flag alone is not trusted: console mode is a commercial
  // feature, and the company flag outlives a lapsed entitlement. When the
  // company has DEFINITELY switched console mode off or is not entitled to it,
  // take the terminal out of console mode (and drop any pin-in) before any
  // loader or action runs as a pinned operator. A settings read error (`null`)
  // is not that answer — tearing the session down on a blip would strand the
  // kiosk out of console mode for good — so it keeps the session and logs.
  const consoleEnabled = consoleMode
    ? await isConsoleModeEnabledForCompany(client, companyId)
    : false;

  if (consoleMode && consoleEnabled === null) {
    log.warn("Console mode state unknown; keeping the console session", {
      companyId
    });
  }

  if (consoleMode && consoleEnabled === false) {
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      await updateSessionConsole(request, undefined)
    );
    headers.append("Set-Cookie", await clearConsolePinIn(companyId));
    // A write never runs: it was authenticated as the pinned operator. Reads
    // retry their own URL; writes land on the shell, which has a loader.
    const { pathname, search } = new URL(request.url);
    return redirect(
      isRead(request) ? `${pathname}${search}` : path.to.authenticatedRoot,
      { headers }
    );
  }

  const { location, updated } = await getLocation(request, client, {
    companyId,
    userId
  });

  // Pin-in state from the signed cookie, re-validated against the database
  // (console mode comes from the auth session). `requirePermissions` resolved
  // the same value into `userId`, memoized for this request.
  const pinIn = consoleMode
    ? await resolveConsolePinIn(request, companyId, sessionUserId)
    : null;

  context.set(userContext, {
    locationId: location,
    companyId,
    consoleMode,
    consoleEnabled: consoleMode ? consoleEnabled : null,
    effectiveUserId: pinIn?.userId ?? sessionUserId,
    pinnedInUser: pinIn
      ? { userId: pinIn.userId, name: pinIn.name, avatarUrl: pinIn.avatarUrl }
      : null
  });

  if (updated) {
    const locationCookie = setLocation(companyId, location);

    // A write keeps going with the new cookie on its response — the request
    // already has `location` in context. Redirecting it would drop the write.
    if (!isRead(request)) {
      const response = (await next()) as Response;
      response.headers.append("Set-Cookie", locationCookie);
      return response;
    }

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
        "Set-Cookie": locationCookie
      }
    });
  }
};
