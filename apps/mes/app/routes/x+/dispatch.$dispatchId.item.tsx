import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { addMaintenanceDispatchItem } from "~/services/maintenance.service";

const logger = getLogger("mes", "dispatch-item");

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

    // The insert runs as the service role: the dispatch and the item must both
    // belong to this company.
    const [dispatch, item] = await Promise.all([
      serviceRole
        .from("maintenanceDispatch")
        .select("id")
        .eq("id", dispatchId)
        .eq("companyId", companyId)
        .maybeSingle(),
      serviceRole
        .from("item")
        .select("id")
        .eq("id", itemId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (!dispatch.data || !item.data) {
      logger.warn("Dispatch or item not found for company", {
        companyId,
        dispatchId,
        itemId,
        error: dispatch.error ?? item.error
      });
      return data(
        {},
        await flash(request, error(null, "Failed to add spare part"))
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
      }
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
