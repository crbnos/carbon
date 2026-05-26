import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteDemandProjections } from "~/modules/production/production.service.server";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "production"
  });

  const { itemId, locationId } = params;

  if (!itemId || !locationId) {
    return data(
      {},
      await flash(
        request,
        error("Item ID and Location ID are required", "Missing parameters")
      )
    );
  }

  // Get current date to determine future periods
  const periods = await getOrCreatePeriods(today(getLocalTimeZone()), 52);

  // Only delete projections for future periods (current week and beyond)
  const futurePeriodIds = periods.map((p) => p.id);

  const result = await deleteDemandProjections({
    itemId,
    locationId,
    futurePeriodIds
  });

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error("Failed to delete demand projections", "Delete failed")
      )
    );
  }

  return redirect(
    path.to.demandProjections + `?location=${locationId}`,
    await flash(request, success("Demand projections deleted successfully"))
  );
}
