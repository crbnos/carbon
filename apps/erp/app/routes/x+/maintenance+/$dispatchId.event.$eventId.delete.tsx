import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteMaintenanceDispatchEvent } from "~/modules/resources";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "resources"
  });

  const { dispatchId, eventId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");
  if (!eventId) throw new Error("Could not find eventId");

  const result = await deleteMaintenanceDispatchEvent(client, eventId);

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
