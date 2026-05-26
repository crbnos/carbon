import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { isMaintenanceDispatchLocked } from "~/modules/resources";
import {
  deleteMaintenanceDispatchEvent,
  getMaintenanceDispatch
} from "~/modules/resources/resources.service.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "resources"
  });

  const { dispatchId, eventId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");
  if (!eventId) throw new Error("Could not find eventId");

  await requirePermissions(request, {
    view: "resources"
  });
  const dispatch = await getMaintenanceDispatch(dispatchId);
  await requireUnlocked({
    request,
    isLocked: isMaintenanceDispatchLocked(dispatch.data?.status),
    redirectTo: path.to.maintenanceDispatch(dispatchId),
    message: "Cannot modify a locked dispatch. Reopen it first."
  });

  const result = await deleteMaintenanceDispatchEvent(eventId);

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
      await flash(request, error(result.error, "Failed to delete timecard"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
    await flash(request, success("Timecard removed successfully"))
  );
}
