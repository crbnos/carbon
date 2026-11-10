// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { purchaseOrderPaymentValidator } from "~/modules/purchasing/purchasing.models";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const formData = await request.formData();
  const validation = await validator(purchaseOrderPaymentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // The operation refuses an order in approval or finished.
  const api = await carbon(request);
  const result = await api.purchasing.upsertPurchaseOrderPayment({
    ...validation.data,
    id: orderId,
    customFields: setCustomFields(formData)
  });

  return respond(request, result).redirect(
    path.to.purchaseOrderDetails(orderId),
    { message: "Updated purchase order payment" }
  );
}
