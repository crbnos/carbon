import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { demandProjectionValidator } from "~/modules/production/production.models";
import {
  getDemandProjections,
  upsertDemandProjections
} from "~/modules/production/production.service";
import DemandProjectionsForm from "~/modules/production/ui/DemandProjection/DemandProjectionForm";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

const WEEKS_TO_PROJECT = 52;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const { itemId, locationId } = params;

  if (!itemId || !locationId) {
    throw new Error("Item ID and Location ID are required");
  }

  const periods = await getOrCreatePeriods(
    datetime.today(await getLocationTimeZone(client, locationId, companyId)),
    WEEKS_TO_PROJECT
  );

  // Load existing demand forecasts for this item and location
  const existingProjections = await getDemandProjections(client, {
    itemId,
    locationId,
    companyId,
    periodIds: periods.map((p) => p.id)
  });

  // Map existing forecasts to week fields
  const weekValues: Record<string, number> = {};
  if (existingProjections.data) {
    periods.forEach((period, index) => {
      const forecast = existingProjections.data?.find(
        (f) => f.periodId === period.id
      );
      weekValues[`week${index}`] = forecast?.forecastQuantity ?? 0;
    });
  }

  const initialValues = {
    itemId,
    locationId,
    ...weekValues
  };

  return {
    periods,
    initialValues
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "FORECAST",
    redirectTo: path.to.demandProjections
  });

  const { itemId: routeItemId, locationId: routeLocationId } = params;

  if (!routeItemId || !routeLocationId) {
    throw new Error("Item ID and Location ID are required");
  }

  const formData = await request.formData();
  const validation = await validator(demandProjectionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { periods, ...weekData } = validation.data;

  // Extract week values and create/update demand forecast records
  const demandProjections = [];

  for (let i = 0; i < 52; i++) {
    const weekKey = `week${i}` as keyof typeof weekData;
    const quantity = weekData[weekKey];

    if (periods?.[i]) {
      // Include all periods, even with 0 quantity (to handle deletions)
      demandProjections.push({
        itemId: routeItemId,
        locationId: routeLocationId,
        periodId: periods[i],
        forecastQuantity: Number(quantity) ?? 0,
        companyId,
        createdBy: userId,
        updatedBy: userId
      });
    }
  }

  const result = await upsertDemandProjections(client, demandProjections);

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to update demand forecasts")
      )
    );
  }

  return redirect(
    path.to.demandProjections + `?location=${routeLocationId}`,
    await flash(request, success("Demand forecasts updated successfully"))
  );
}

export default function EditProjectionRoute() {
  const { initialValues } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  return (
    <DemandProjectionsForm
      initialValues={initialValues}
      isEditing
      onClose={() => navigate(-1)}
    />
  );
}
