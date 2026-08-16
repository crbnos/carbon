import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteDemandProjections } from "~/modules/production/production.service";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
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
  const periods = await getOrCreatePeriods(
    datetime.today(await getLocationTimeZone(client, locationId, companyId)),
    52
  );

  // Only delete projections for future periods (current week and beyond)
  const futurePeriodIds = periods.map((p) => p.id);

  const result = await deleteDemandProjections(client, {
    itemId,
    locationId,
    companyId,
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
