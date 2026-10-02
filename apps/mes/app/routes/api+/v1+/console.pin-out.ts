// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { logAuthEvent } from "@carbon/auth/auth-events.server";
import { consolePinOutResponse, HEADERS } from "@carbon/mes-core";
import { getClientIp } from "@carbon/utils";
import { apiRoute, json, methodNotAllowed } from "./lib/route.server";

/**
 * The operator pins out.
 *
 * There is nothing server-side to destroy: the operator claim lives only in
 * the signed token the app holds in memory, and dropping it IS the pin-out.
 * That is the point of the design — no session table, so no stolen session to
 * revoke, and a tablet that loses power is pinned out by definition.
 *
 * The endpoint exists for two reasons. It audits the act (the web gets that
 * from the `Set-Cookie` that clears the pin-in), and it gives the app one
 * authoritative confirmation that the operator header it just sent is spent,
 * so the UI does not have to guess.
 *
 * It requires the operator header, so pinning out is attributed to the
 * operator who was working rather than to the terminal.
 *
 * The response pins `x-carbon-operator` to an empty value: every other
 * authenticated response hands back a REFRESHED token to slide the window, and
 * this is the one call that must not. Nothing may resurrect a claim the
 * operator just gave up.
 *
 * Not idempotency-keyed: it writes no business row, and a second pin-out of an
 * already-dropped token is a no-op the app can safely retry.
 */
export const action = apiRoute(
  { method: "POST", idempotent: false },
  async ({ request, user }) => {
    if (!user) throw new Error("unreachable: console/pin-out is not public");

    if (!user.consoleMode) {
      throw new ApiError(
        400,
        "validation_failed",
        "No operator is pinned in at this terminal"
      );
    }

    logAuthEvent("logout", {
      userId: user.userId,
      companyId: user.companyId,
      ip: getClientIp(request) ?? undefined,
      method: "console-pin",
      terminalUserId: user.sessionUserId
    });

    return json(consolePinOutResponse.parse({ ok: true }), {
      headers: { [HEADERS.operator]: "" }
    });
  }
);

export const loader = methodNotAllowed();
