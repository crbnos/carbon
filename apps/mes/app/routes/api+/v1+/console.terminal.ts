// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { logAuthEvent } from "@carbon/auth/auth-events.server";
import { signTerminalToken } from "@carbon/auth/console-token.server";
import { isConsoleModeEnabledForCompany } from "@carbon/ee/console.server";
import { consoleTerminalResponse } from "@carbon/mes-core";
import { getClientIp } from "@carbon/utils";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Turn this tablet into a shared terminal — the mobile counterpart of
 * `x+/console.toggle.tsx`.
 *
 * It takes `settings_update`, checked against the SIGNED-IN account (console
 * mode is never entered by a pinned operator), because a terminal is a device
 * every operator afterwards acts through. The web gate is the same, and for
 * the same reason.
 *
 * The token it returns is bound to this company and this signed-in session, so
 * it is inert on any other tablet. It authorises nothing on its own: the only
 * endpoint that reads it is `POST /console/pin-in`, which also demands this
 * session's Bearer token and a correct PIN, and which re-asks for console mode
 * before minting anything.
 *
 * Not idempotency-keyed: it writes no business row, and a signed token has no
 * business sitting in the idempotency store for 24 hours.
 */
export const action = apiRoute(
  {
    method: "POST",
    permissions: { update: "settings" },
    idempotent: false
  },
  async ({ request, user }) => {
    if (!user) throw new Error("unreachable: console/terminal is not public");

    // A definite `true` only. The company's `consoleEnabled` flag outlives a
    // lapsed entitlement, and `null` means we could not read the answer —
    // entering console mode on an unknown answer is refused, exactly as
    // `x+/console.toggle.tsx` refuses it.
    const enabled = await isConsoleModeEnabledForCompany(
      user.client,
      user.companyId
    );
    if (enabled !== true) {
      throw new ApiError(
        403,
        "forbidden",
        "Console mode is not enabled for this company"
      );
    }

    const terminalToken = await signTerminalToken({
      companyId: user.companyId,
      sessionUserId: user.sessionUserId
    });

    logAuthEvent("login_success", {
      userId: user.sessionUserId,
      actor: user.email || undefined,
      companyId: user.companyId,
      ip: getClientIp(request) ?? undefined,
      method: "console-terminal"
    });

    return consoleTerminalResponse.parse({ terminalToken });
  }
);

export const loader = methodNotAllowed();
