// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { getOperationScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * One operation, from the same `getOperationScreen` the web route calls.
 *
 * Two differences from the web, both because an API caller has no URL:
 *
 *  - the deferred reads the web streams through `Await` are AWAITED here, so
 *    the app gets one complete payload rather than a promise it cannot resolve;
 *  - the first-operation serial auto-select is a redirect on the web; here the
 *    resolved unit comes back as `trackedEntityId` in the body.
 *
 * A floor-gate refusal (an unreleased job, or a batch that has not been
 * released) is a 409 carrying the exact message the operator would read on the
 * web — not a 403, because the operator's permissions are fine; the work simply
 * is not on the floor yet.
 */
export const loader = apiRoute(
  { method: "GET" },
  async ({ request, params, user }) => {
    if (!user) throw new Error("unreachable: /operations/:id is not public");

    const operationId = params.id;
    if (!operationId) {
      throw new ApiError(400, "validation_failed", "No operation was given");
    }

    const url = new URL(request.url);
    const requestedEntityId = url.searchParams.get("trackedEntityId");

    const screen = await getOperationScreen(getCarbonServiceRole(), {
      companyId: user.companyId,
      userId: user.userId,
      operationId,
      trackedEntityId: requestedEntityId
    });

    if (!screen.ok) {
      const { failure } = screen;
      // Assembly and Inspection operations have their own views. Inspection
      // now has one here too — `GET /operations/:id/inspection` — and
      // `details.view` is what tells a client to go there, so the message says
      // where rather than that something went wrong. Assembly needs a 3D
      // viewer and stays on web MES.
      const view = (failure.details as { view?: string } | undefined)?.view;
      const message = view
        ? view === "assembly"
          ? "Assembly operations open in Carbon MES on the web"
          : "This is an inspection — open it at /operations/:id/inspection"
        : failure.message || "This operation is not available";

      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        failure.kind === "not_found"
          ? "not_found"
          : failure.kind === "redirect"
            ? "conflict"
            : "internal",
        message,
        undefined,
        failure.details
      );
    }

    const {
      autoSelectTrackedEntityId,
      files,
      materials,
      procedure,
      workCenter,
      nonConformanceActions,
      batchWorkInstructions,
      ...rest
    } = screen.data;

    const [
      resolvedFiles,
      resolvedMaterials,
      resolvedProcedure,
      resolvedWorkCenter,
      resolvedActions,
      resolvedBatchInstructions
    ] = await Promise.all([
      files,
      materials,
      procedure,
      workCenter,
      nonConformanceActions,
      batchWorkInstructions
    ]);

    return {
      ...rest,
      trackedEntityId: requestedEntityId ?? autoSelectTrackedEntityId,
      files: resolvedFiles,
      materials: resolvedMaterials,
      procedure: resolvedProcedure,
      workCenter: resolvedWorkCenter,
      nonConformanceActions: resolvedActions,
      batchWorkInstructions: resolvedBatchInstructions
    };
  }
);
