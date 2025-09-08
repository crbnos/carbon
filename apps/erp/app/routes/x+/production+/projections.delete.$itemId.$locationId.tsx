import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { deleteFutureDemandForecasts } from "~/modules/production/production.service";
import { getPeriods } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "production",
  });

  const { itemId, locationId } = params;
  
  if (!itemId || !locationId) {
    return json(
      {},
      await flash(
        request,
        error("Item ID and Location ID are required", "Missing parameters")
      )
    );
  }

  // Get current date to determine future periods
  const startDate = startOfWeek(today(getLocalTimeZone()), "en-US");
  const endDate = startDate.add({ weeks: 52 });
  const periods = await getPeriods(client, {
    startDate: startDate.toString(),
    endDate: endDate.toString(),
  });

  if (periods.error) {
    return json(
      {},
      await flash(
        request,
        error(periods.error, "Failed to load periods")
      )
    );
  }

  // Only delete forecasts for future periods (current week and beyond)
  const futurePeriodIds = periods.data?.map(p => p.id) ?? [];

  const result = await deleteFutureDemandForecasts(client, {
    itemId,
    locationId,
    companyId,
    futurePeriodIds,
  });

  if (result.error) {
    return json(
      {},
      await flash(
        request,
        error("Failed to delete demand forecasts", "Delete failed")
      )
    );
  }

  return redirect(
    path.to.productionProjections + `?location=${locationId}`,
    await flash(request, success("Demand forecasts deleted successfully"))
  );
}