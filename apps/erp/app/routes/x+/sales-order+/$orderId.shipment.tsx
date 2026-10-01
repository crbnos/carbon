// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getSalesOrder,
  isSalesOrderLocked,
  salesOrderShipmentValidator,
  upsertSalesOrderShipment
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });

  const salesOrder = await getSalesOrder(viewClient, orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesOrderLocked(salesOrder.data?.status),
    redirectTo: path.to.salesOrderDetails(orderId),
    message: "Cannot modify a locked sales order. Reopen it first."
  });

  const { client, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesOrderShipmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateSalesOrderShipment = await upsertSalesOrderShipment(client, {
    ...validation.data,
    id: orderId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateSalesOrderShipment.error) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(
        request,
        error(
          updateSalesOrderShipment.error,
          "Failed to update sales order shipment"
        )
      )
    );
  }

  throw redirect(
    path.to.salesOrderDetails(orderId),
    await flash(request, success("Updated sales order shipment"))
  );
}
