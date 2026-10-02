// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inspectionDispositionBody } from "@carbon/mes-core";
import { dispositionInspectionLot } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { toApiError } from "./lib/failure.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Close the lot — the same `dispositionInspectionLot` command
 * `x+/inspection-lot.$id.disposition.tsx` runs, so the verdict carries the same
 * physical outcome on a tablet as in a browser: the buckets are recomputed from
 * the database, the lot is closed FIRST (one-shot `requireOpen`, the
 * serialization point), and only then are the completions, the scrap, the
 * rework clone and the optional NCR posted.
 *
 * Three clients, each where the web route used it: the Kysely pool closes the
 * lot, the service role invokes `issue` / `trigger-rework` / `recalculate`, and
 * the CALLER's RLS client posts the `productionQuantity` and scrap rows.
 *
 * Idempotency-keyed like every other POST, and that matters more here than
 * anywhere else in this API. A failure AFTER the close is a 500, the window
 * STORES and REPLAYS a 5xx, and the close is one-shot — so an automatic retry
 * can neither re-run a half-applied disposition nor clone the rework branch
 * twice. Only the operator minting a new key can try again, which is the same
 * guarantee close-first gives the web.
 *
 * `warnings` in a 200 body is not a failure: the lot IS closed and the units
 * ARE posted. Each string names a follow-up that did not land, and the app
 * should show it beside the outcome rather than offering a retry.
 */
export const action = apiRoute(
  {
    method: "POST",
    body: inspectionDispositionBody,
    permissions: { update: "quality" }
  },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: inspections is not public");

    const inspectionId = params.id;
    if (!inspectionId) {
      throw new ApiError(400, "validation_failed", "No inspection was given");
    }
    if (body.inspectionId !== inspectionId) {
      throw new ApiError(
        400,
        "validation_failed",
        "The inspection in the body does not match the inspection in the path"
      );
    }

    const result = await dispositionInspectionLot(
      {
        serviceRole: await getCarbonServiceRole(),
        client: user.client,
        db: getDatabaseClient()
      },
      {
        companyId: user.companyId,
        // The disposition is a signed decision — the OPERATOR's, not the
        // terminal account's.
        userId: user.userId
      },
      {
        inspectionId,
        decision: body.decision,
        operationId: body.operationId,
        scrapEntityIds: body.scrapEntityIds,
        reworkEntityIds: body.reworkEntityIds,
        scrapQuantity: body.scrapQuantity,
        reworkQuantity: body.reworkQuantity,
        scrapReasonId: body.scrapReasonId,
        targetOperationId: body.targetOperationId,
        reworkReason: body.reworkReason,
        createNcr: body.createNcr,
        nonConformanceTypeId: body.nonConformanceTypeId,
        // Named one by one: `eventIds` is SPREAD into the `issue` and scrap
        // payloads, so handing it the whole body would smuggle the decision
        // and the allocation into an edge-function call.
        eventIds: {
          setupProductionEventId: body.setupProductionEventId,
          laborProductionEventId: body.laborProductionEventId,
          machineProductionEventId: body.machineProductionEventId
        }
      }
    );
    if (!result.ok) throw toApiError(result.failure);

    return result.data;
  }
);

export const loader = methodNotAllowed();
