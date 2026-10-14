// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { maintenanceDispatchStatus } from "~/modules/resources";
import { postMaintenanceLabor } from "~/modules/resources/resources.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const { dispatchId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof maintenanceDispatchStatus)[number];

  if (!status || !maintenanceDispatchStatus.includes(status)) {
    throw redirect(
      requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await client
    .from("maintenanceDispatch")
    .update({
      status,
      assignee: ["Completed", "Cancelled"].includes(status) ? null : undefined,
      actualStartTime:
        status === "In Progress" ? new Date().toISOString() : undefined,
      updatedBy: userId
    })
    .eq("id", dispatchId);

  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
      await flash(
        request,
        error(update.error, "Failed to update dispatch status")
      )
    );
  }

  // Completing closes every open timecard (end_maintenance_events_on_complete)
  // — post their labor.
  const postingError =
    status === "Completed"
      ? await postMaintenanceLabor({
          maintenanceDispatchIds: [dispatchId],
          companyId,
          userId
        })
      : null;

  throw redirect(
    requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
    await flash(
      request,
      postingError
        ? error(
            postingError,
            "Updated dispatch status, but its labor cost did not post"
          )
        : success("Updated dispatch status")
    )
  );
}
