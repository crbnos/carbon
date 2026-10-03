// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { pickTrackedEntity } from "~/services/commands.picking.server";
import { getPickingTrackedOptionsScreen } from "~/services/screens.server";

/**
 * GET: available tracked lots for a picking line (non-lineside, deduped),
 * smart-ordered for the TrackedEntityPicker. POST: pick/unpick a chosen lot.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  const { lineId, pickingListId } = params;
  if (!lineId) throw new Response("Not found", { status: 404 });

  // The read itself lives in `~/services/screens.server` so this route and
  // `GET /api/v1/picking/:listId/lines/:lineId/tracked-options` cannot drift.
  const screen = await getPickingTrackedOptionsScreen(client, {
    companyId,
    pickingListId,
    lineId
  });

  if (!screen.ok) throw new Response("Line not found", { status: 404 });

  return screen.data;
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();

  const result = await pickTrackedEntity(
    serviceRole,
    { companyId, userId: effectiveUserId },
    {
      pickingListLineId: params.lineId,
      trackedEntityId: formData.get("trackedEntityId") as string,
      fromStorageUnitId: (formData.get("fromStorageUnitId") as string) || null,
      quantity: Number(formData.get("quantity") ?? 0),
      unpick: formData.get("unpick") === "true"
    }
  );

  if (!result.ok) {
    return { success: false, message: result.failure.message };
  }

  return { success: true, data: result.data };
}
