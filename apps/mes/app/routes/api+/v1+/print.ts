// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { HEADERS } from "@carbon/mes-core";
import { printBody } from "@carbon/mes-core/models";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { printLabel } from "~/services/commands.steps.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Queue a label print — the same `print-job` event `x+/print.tsx` fires, so it
 * reaches the same printers through Inngest and the ProxyBox. Nothing is printed
 * from the device: mobile operating systems make raw network and Bluetooth
 * printing hard, and the server already knows the printers (research, Pattern 4).
 *
 * `locationId` comes from the header here; the web form carries it in its
 * validated body. Without a location the job cannot be routed to a printer, so
 * this is a 400 rather than a silently unrouted print.
 */
export const action = apiRoute(
  { method: "POST", body: printBody },
  async ({ request, body, user }) => {
    if (!user) throw new Error("unreachable: this endpoint is not public");

    const locationId = request.headers.get(HEADERS.location)?.trim();
    if (!locationId) {
      throw new ApiError(
        400,
        "location_required",
        "Choose a location before printing"
      );
    }

    const result = await printLabel(
      { companyId: user.companyId, userId: user.userId, locationId },
      body
    );

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        "internal",
        failure.message,
        failure.fields
      );
    }

    return { ok: true as const };
  }
);

export const loader = methodNotAllowed();
