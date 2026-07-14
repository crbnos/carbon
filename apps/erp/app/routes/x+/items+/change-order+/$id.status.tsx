import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { ChangeOrderMergeResolution } from "~/modules/items";
import {
  changeOrderBroadcastStages,
  changeOrderStatusValidator,
  updateChangeOrderStatus
} from "~/modules/items";
import {
  applyChangeOrder,
  changeOrderStageEvent,
  notifyChangeOrderTransition
} from "~/modules/items/changeOrder.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId, companyGroupId } =
    await requirePermissions(request, {
      update: "parts"
    });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(changeOrderStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    fromStatus,
    status: toStatus,
    assignee,
    resolutions: resolutionsRaw,
    mergeAcknowledged
  } = validation.data;

  // Release-time merge picks (Q3), sent only when releasing through the merge UI.
  let resolutions: ChangeOrderMergeResolution[] = [];
  if (resolutionsRaw) {
    try {
      const parsed = JSON.parse(resolutionsRaw);
      if (Array.isArray(parsed)) resolutions = parsed;
    } catch {
      // Ignore malformed picks — the server recomputes conflicts + defaults.
    }
  }

  // Implementation → Done IS the apply: applyChangeOrder edits each affected
  // assembly's BOM via the canonical make-method helpers and performs the final
  // CAS flip to Done (G1/G2). All other transitions go through the plain guarded
  // status writer.
  if (toStatus === "Done") {
    const applied = await applyChangeOrder(client, getDatabaseClient(), {
      changeOrderId: id,
      userId,
      companyId,
      resolutions,
      mergeAcknowledged: mergeAcknowledged === "true"
    });
    if (applied.error || !applied.data) {
      throw redirect(
        requestReferrer(request) ?? path.to.changeOrderDetails(id),
        await flash(
          request,
          error(applied.error, "Failed to apply change order")
        )
      );
    }
  } else {
    const update = await updateChangeOrderStatus(client, {
      id,
      companyId,
      fromStatus,
      toStatus,
      assignee,
      updatedBy: userId
    });

    if (update.error || !update.data) {
      throw redirect(
        requestReferrer(request) ?? path.to.changeOrderDetails(id),
        await flash(
          request,
          error(update.error, "Failed to update change order status")
        )
      );
    }
  }

  // Broadcast to the company team only on the stages that broadcast on entry
  // (Start / Implementation / Done). Best-effort; never blocks the redirect.
  if (changeOrderBroadcastStages.includes(toStatus)) {
    await notifyChangeOrderTransition({
      event: changeOrderStageEvent[toStatus],
      changeOrderId: id,
      companyId,
      companyGroupId,
      userId
    });
  }

  throw redirect(
    requestReferrer(request) ?? path.to.changeOrderDetails(id),
    await flash(request, success("Updated change order status"))
  );
}
