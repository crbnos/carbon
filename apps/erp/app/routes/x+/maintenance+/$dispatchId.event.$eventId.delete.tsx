// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deleteMaintenanceDispatchEvent,
  getMaintenanceDispatch,
  isMaintenanceDispatchLocked
} from "~/modules/resources";
import { postMaintenanceLabor } from "~/modules/resources/resources.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "resources"
  });

  const { dispatchId, eventId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");
  if (!eventId) throw new Error("Could not find eventId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "resources"
  });
  const dispatch = await getMaintenanceDispatch(viewClient, dispatchId);
  await requireUnlocked({
    request,
    isLocked: isMaintenanceDispatchLocked(dispatch.data?.status),
    redirectTo: path.to.maintenanceDispatch(dispatchId),
    message: "Cannot modify a locked dispatch. Reopen it first."
  });

  const result = await deleteMaintenanceDispatchEvent(client, eventId);

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
      await flash(request, error(result.error, "Failed to delete timecard"))
    );
  }

  // Reverses the labor cost the deleted timecard posted.
  const postingError = await postMaintenanceLabor({
    maintenanceDispatchIds: [dispatchId],
    companyId,
    userId
  });

  throw redirect(
    requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
    await flash(
      request,
      postingError
        ? error(
            postingError,
            "Timecard removed, but its labor cost was not reversed"
          )
        : success("Timecard removed successfully")
    )
  );
}
