import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getPurchaseReturnOrder,
  isPurchaseReturnOrderLocked,
  purchaseReturnOrderLineValidator,
  setPurchaseReturnOrderLineTrackedEntities,
  upsertPurchaseReturnOrderLine
} from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id: orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });

  const purchaseReturnOrder = await getPurchaseReturnOrder(viewClient, orderId);
  await requireUnlocked({
    request,
    isLocked: isPurchaseReturnOrderLocked(purchaseReturnOrder.data?.status),
    redirectTo: path.to.purchaseReturnOrderDetails(orderId),
    message: "Cannot add lines to a completed or cancelled return order."
  });

  // Line quantities are validated against source caps at Confirm; adding
  // lines afterwards would bypass that validation entirely.
  if (purchaseReturnOrder.data?.status !== "Draft") {
    throw redirect(
      path.to.purchaseReturnOrderDetails(orderId),
      await flash(
        request,
        error(null, "Lines can only be added while the return order is Draft")
      )
    );
  }

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseReturnOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, trackedEntityIds, ...d } = validation.data;

  // The locked-order guard above checked the URL's order — write to that same
  // order, never the form's copy of the id.
  d.purchaseReturnOrderId = orderId;

  const createLine = await upsertPurchaseReturnOrderLine(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createLine.error || !createLine.data) {
    throw redirect(
      path.to.purchaseReturnOrderDetails(orderId),
      await flash(
        request,
        error(createLine.error, "Failed to create return order line")
      )
    );
  }

  // A line added from a document knows its purchase order — link the header
  // automatically when it isn't linked yet. The first line's order wins and a
  // manually-linked header is never overwritten, so multi-order returns still
  // work. Best-effort: a failure here leaves the manual link available.
  if (!purchaseReturnOrder.data?.purchaseOrderId) {
    let purchaseOrderLineId = d.purchaseOrderLineId ?? null;
    if (!purchaseOrderLineId && d.receiptLineId) {
      const receiptLine = await client
        .from("receiptLine")
        .select("lineId")
        .eq("id", d.receiptLineId)
        .eq("companyId", companyId)
        .maybeSingle();
      purchaseOrderLineId = receiptLine.data?.lineId ?? null;
    }
    if (purchaseOrderLineId) {
      const purchaseOrderLine = await client
        .from("purchaseOrderLine")
        .select("purchaseOrderId")
        .eq("id", purchaseOrderLineId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (purchaseOrderLine.data?.purchaseOrderId) {
        await client
          .from("purchaseReturnOrder")
          .update({
            purchaseOrderId: purchaseOrderLine.data.purchaseOrderId,
            updatedBy: userId
          })
          .eq("id", orderId)
          .eq("companyId", companyId);
      }
    }
  }

  if (trackedEntityIds && trackedEntityIds.length > 0) {
    const setEntities = await setPurchaseReturnOrderLineTrackedEntities(
      client,
      createLine.data.id,
      companyId,
      trackedEntityIds,
      userId
    );
    if (setEntities.error) {
      throw redirect(
        path.to.purchaseReturnOrderLine(orderId, createLine.data.id),
        await flash(
          request,
          error(setEntities.error, "Failed to set tracked entities")
        )
      );
    }
  }

  throw redirect(path.to.purchaseReturnOrderLine(orderId, createLine.data.id));
}
