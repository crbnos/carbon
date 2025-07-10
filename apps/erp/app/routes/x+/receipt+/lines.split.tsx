import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { FunctionRegion } from "@supabase/supabase-js";
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

  const receiptLine = await client
    .from("receiptLine")
    .select("*")
    .eq("id", documentLineId)
    .single();

  if (receiptLine.error) {
    return json({
      success: false,
    });
  }

  if (receiptLine.data.companyId !== companyId) {
    return json({
      success: false,
    });
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
      userId: userId,
    },
    region: FunctionRegion.UsEast1,
  });

  if (salesOrderShipment.error) {
    return json({
      success: false,
    });
  }

  return json({ success: true });
}
