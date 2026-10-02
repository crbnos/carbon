// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { scrapBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { reportScrap } from "~/services/commands.quantities.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Report scrap — `reportScrap`, the body of `x+/scrap.tsx` unchanged: ONE
 * transactional `issue` `jobOperationScrap` invoke, which records the Scrap
 * `productionQuantity`, backflushes the unit's BOM, flips the selected serial
 * to Scrapped, spawns the replacement serial, reopens Done operations and
 * posts the WIP→scrap journal. Splitting it would leave a half-scrapped unit.
 *
 * `newTrackedEntityId` is the spawned replacement; the app advances to it the
 * same way the web client does.
 */
export const action = apiRoute(
  { method: "POST", body: scrapBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: /operations/:id/scrap is private");

    const result = await reportScrap(
      {
        companyId: user.companyId,
        userId: user.userId,
        sessionUserId: user.sessionUserId,
        source: "mes_mobile"
      },
      { ...body, jobOperationId: params.id as string }
    );
    if (!result.ok) throw toApiError(result.failure);

    return {
      ok: true as const,
      scrapped: true as const,
      newTrackedEntityId: result.data.newTrackedEntityId ?? null
    };
  }
);

export const loader = methodNotAllowed();

/** `FAILURE_STATUS` owns the status; only two kinds need a different code. */
function toApiError(failure: CommandFailure) {
  const code: ApiErrorCode =
    failure.kind === "redirect"
      ? "conflict"
      : failure.kind === "error"
        ? "internal"
        : failure.kind === "validation"
          ? "validation_failed"
          : failure.kind;
  return new ApiError(
    FAILURE_STATUS[failure.kind],
    code,
    failure.message,
    failure.fields
  );
}
