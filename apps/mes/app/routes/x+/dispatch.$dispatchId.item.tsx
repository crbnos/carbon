import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import { type ActionFunctionArgs, data } from "react-router";
import { addMaintenanceDispatchItem } from "~/services/maintenance.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});
  const { dispatchId } = params;

  if (!dispatchId) {
    return data({}, await flash(request, error("Dispatch ID is required")));
  }

  const formData = await request.formData();
  const action = formData.get("action") as "add" | "delete";

  const serviceRole = await getCarbonServiceRole();

  if (action === "add") {
    const itemId = formData.get("itemId") as string;
    const quantity = Number(formData.get("quantity"));
    const unitOfMeasureCode = formData.get("unitOfMeasureCode") as string;

    if (!itemId) {
      return data({}, await flash(request, error("Item is required")));
    }

    if (!quantity || quantity <= 0) {
      return data(
        {},
        await flash(request, error("Valid quantity is required"))
      );
    }

    const result = await addMaintenanceDispatchItem(serviceRole, {
      maintenanceDispatchId: dispatchId,
      itemId,
      quantity,
      unitOfMeasureCode: unitOfMeasureCode || "EA",
      companyId,
      createdBy: userId
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to add spare part"))
      );
    }

    return data(
      { id: result.data?.id },
      await flash(request, success("Spare part added"))
    );
  }

  if (action === "delete") {
    const itemId = formData.get("itemId") as string;

    if (!itemId) {
      return data({}, await flash(request, error("Item ID is required")));
    }

    const result = await serviceRole.functions.invoke("issue", {
      body: {
        type: "maintenanceDispatchUnissue",
        maintenanceDispatchItemId: itemId,
        companyId,
        userId
      },
      region: FunctionRegion.UsEast1
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to remove spare part"))
      );
    }

    return data(
      {},
      await flash(
        request,
        success("Spare part removed and returned to inventory")
      )
    );
  }

  return data({});
}
