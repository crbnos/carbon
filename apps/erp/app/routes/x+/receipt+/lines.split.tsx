// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { splitValidator } from "~/modules/inventory";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(splitValidator).validate(formData);

  if (validation.error) {
    return {
      success: false
    };
  }

  const { documentId, documentLineId, quantity, locationId } = validation.data;

  const receiptLine = await client
    .from("receiptLine")
    .select("*")
    .eq("id", documentLineId)
    .single();

  if (receiptLine.error) {
    return {
      success: false
    };
  }

  if (receiptLine.data.companyId !== companyId) {
    return {
      success: false
    };
  }

  const serviceRole = getCarbonServiceRole();

  const salesOrderShipment = await serviceRole.functions.invoke<{
    id: string;
  }>("create", {
    body: {
      type: "receiptLineSplit",
      companyId,
      locationId,
      receiptId: documentId,
      receiptLineId: documentLineId,
      quantity,
      userId: userId
    }
  });

  if (salesOrderShipment.error) {
    return {
      success: false
    };
  }

  return { success: true };
}
