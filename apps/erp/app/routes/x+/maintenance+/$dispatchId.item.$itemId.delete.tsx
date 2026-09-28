import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  LOCKED_DISPATCH_MESSAGE,
  removeMaintenanceDispatchItem
} from "~/modules/resources/resources.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "dispatchid-item-itemid-delete");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {
    delete: "resources"
  });

  const { dispatchId, itemId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");
  if (!itemId) throw new Error("Could not find itemId");

  const result = await removeMaintenanceDispatchItem({
    maintenanceDispatchItemId: itemId,
    dispatchId,
    companyId,
    userId
  });

  if (result.error) {
    if (result.error.message === LOCKED_DISPATCH_MESSAGE) {
      throw redirect(
        path.to.maintenanceDispatch(dispatchId),
        await flash(request, error(null, LOCKED_DISPATCH_MESSAGE))
      );
    }
    logger.error("Failed to remove maintenance dispatch item", {
      companyId,
      error: result.cause ?? result.error
    });
    throw redirect(
      requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
      await flash(request, error(result.cause, result.error.message))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.maintenanceDispatch(dispatchId),
    await flash(request, success("Item removed and returned to inventory"))
  );
}
