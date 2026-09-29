import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import type { ServerFnResult } from "@carbon/server-functions";
import { create } from "@carbon/server-functions/create";
import type { ActionFunctionArgs } from "react-router";
import { splitValidator } from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";

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

  const salesOrderShipment = await (create.withClient(
    serviceRole,
    getDatabaseClient(),
    {
      type: "receiptLineSplit",
      companyId,
      locationId,
      receiptId: documentId,
      receiptLineId: documentLineId,
      quantity,
      userId: userId
    }
  ) as Promise<
    ServerFnResult<{
      id: string;
    }>
  >);

  if (salesOrderShipment.error) {
    return {
      success: false
    };
  }

  return { success: true };
}
