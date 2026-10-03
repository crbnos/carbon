// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { endEventBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { endEvent } from "~/services/commands.time.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Stop a timer — the `endEvent` command, which is the End branch of
 * `x+/event.tsx` unchanged: it closes the named `productionEvent` and posts it
 * to `post-production-event` UNLESS the event is batch-tagged, because a batch
 * posts its cost once at batch completion and posting here too would
 * double-book it.
 *
 * The write uses the caller's own RLS-scoped client, as the web Stop button does.
 */
export const action = apiRoute(
  { method: "POST", body: endEventBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: /events/:id/end is private");

    const result = await endEvent(user.client, {
      companyId: user.companyId,
      userId: user.userId,
      sessionUserId: user.sessionUserId,
      eventId: params.id as string,
      source: "mes_mobile",
      exclusive: body.exclusive
    });
    if (!result.ok) throw toApiError(result.failure);

    return { ok: true as const, eventId: params.id as string };
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
