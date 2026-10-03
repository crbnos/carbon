// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { startEventBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import {
  startEvent,
  startOperationFromScan
} from "~/services/commands.time.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Start a timer on an operation.
 *
 * ONE endpoint, TWO commands, because the web has two start paths that must
 * stay distinguishable (`.claude/rules/mes-job-operation-ui.md`):
 *
 *   - `viaScan: false` (the default) runs `startEvent` — the in-app Start
 *     button, `x+/event.tsx`. Ability gate only, and the write goes through the
 *     caller's own RLS-scoped client, exactly as the web button does.
 *   - `viaScan: true` runs `startOperationFromScan` — the QR traveller,
 *     `x+/start/:operationId`. Floor gate (before the timer re-opens), blocked
 *     work center, `operationStart` rules, serial selection, service role.
 *
 * Collapsing the two would either gate the button (operators could no longer
 * clock onto an op the floor gate dislikes) or ungate the scan (a not-released
 * job's timers would re-open from a printed sheet).
 *
 * No module permission, matching the web routes' `requirePermissions(request, {})`.
 * `requireApiUser` has already refused anyone who is not an employee of the company.
 */
export const action = apiRoute(
  { method: "POST", body: startEventBody },
  async ({ params, body, user }) => {
    if (!user)
      throw new Error("unreachable: /operations/:id/events is private");

    // The path names the operation; a body `jobOperationId` that disagrees is a
    // confused client, and the URL is what the operator scanned or tapped.
    const jobOperationId = params.id as string;

    if (body.viaScan) {
      const result = await startOperationFromScan(getCarbonServiceRole(), {
        companyId: user.companyId,
        userId: user.userId,
        sessionUserId: user.sessionUserId,
        operationId: jobOperationId,
        type: body.type,
        trackedEntityId: body.trackedEntityId,
        source: "mes_mobile"
      });
      if (!result.ok) throw toApiError(result.failure);
      return { ok: true as const, eventId: null };
    }

    const result = await startEvent(user.client, {
      companyId: user.companyId,
      userId: user.userId,
      sessionUserId: user.sessionUserId,
      source: "mes_mobile",
      body: { ...body, jobOperationId }
    });
    if (!result.ok) throw toApiError(result.failure);

    // `startProductionEvent` answers with one row on the tracked path and an
    // array on the untracked one; the app only needs the id to stop it again.
    const data = result.data as { id?: string } | { id?: string }[] | null;
    const eventId = Array.isArray(data)
      ? (data[0]?.id ?? null)
      : (data?.id ?? null);
    return { ok: true as const, eventId };
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
