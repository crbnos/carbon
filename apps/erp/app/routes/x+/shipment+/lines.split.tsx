import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { splitValidator } from "~/modules/inventory";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const formData = await request.formData();
  const validation = await validator(splitValidator).validate(formData);

  if (validation.error) {
    return json({
      success: false,
    });
  }

  const { documentId, documentLineId, quantity, locationId } = validation.data;

  const shipmentLine = await client
    .from("shipmentLine")
    .select("*")
    .eq("id", documentLineId)
    .single();

  if (shipmentLine.error) {
    return json({
      success: false,
    });
  }

  if (shipmentLine.data.companyId !== companyId) {
    return json({
      success: false,
    });
  }

  const serviceRole = getCarbonServiceRole();

  const salesOrderShipment = await serviceRole.functions.invoke<{
    id: string;
  }>("create-inventory-document", {
    body: {
      type: "shipmentLineSplit",
      companyId,
      locationId,
      shipmentId: documentId,
      shipmentLineId: documentLineId,
      quantity,
      userId: userId,
    },
  });

  if (salesOrderShipment.error) {
    return json({
      success: false,
    });
  }

  return json({ success: true });
}
