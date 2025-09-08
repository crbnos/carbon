import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { productionProjectionsValidator } from "~/modules/production/production.models";
import {
  getDemandForecasts,
  upsertDemandForecasts,
} from "~/modules/production/production.service";
import ProductionProjectionsForm from "~/modules/production/ui/Projections/ProductionProjectionsForm";
import { getPeriods } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

const WEEKS_TO_PROJECT = 52;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
  });

  const { itemId, locationId } = params;

  if (!itemId || !locationId) {
    throw new Error("Item ID and Location ID are required");
  }

  const startDate = startOfWeek(today(getLocalTimeZone()), "en-US");
  const endDate = startDate.add({ weeks: WEEKS_TO_PROJECT });
  const periods = await getPeriods(client, {
    startDate: startDate.toString(),
    endDate: endDate.toString(),
  });

  if (periods.error) {
    throw new Error("Failed to load periods");
  }

  // Load existing demand forecasts for this item and location
  const existingForecasts = await getDemandForecasts(client, {
    itemId,
    locationId,
    companyId,
    periodIds: periods.data?.map((p) => p.id) ?? [],
  });

  // Map existing forecasts to week fields
  const weekValues: Record<string, number> = {};
  if (existingForecasts.data && periods.data) {
    periods.data.forEach((period, index) => {
      const forecast = existingForecasts.data?.find(
        (f) => f.periodId === period.id
      );
      weekValues[`week${index}`] = forecast?.forecastQuantity ?? 0;
    });
  }

  const initialValues = {
    itemId,
    locationId,
    ...weekValues,
  };

  return json({
    periods: periods.data ?? [],
    initialValues,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
  });

  const { itemId: routeItemId, locationId: routeLocationId } = params;

  if (!routeItemId || !routeLocationId) {
    throw new Error("Item ID and Location ID are required");
  }

  const formData = await request.formData();
  const validation = await validator(productionProjectionsValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { periods, ...weekData } = validation.data;

  // Extract week values and create/update demand forecast records
  const demandForecasts = [];

  for (let i = 0; i < 52; i++) {
    const weekKey = `week${i}` as keyof typeof weekData;
    const quantity = weekData[weekKey];

    if (periods?.[i]) {
      // Include all periods, even with 0 quantity (to handle deletions)
      demandForecasts.push({
        itemId: routeItemId,
        locationId: routeLocationId,
        periodId: periods[i],
        forecastQuantity: Number(quantity) ?? 0,
        companyId,
        createdBy: userId,
        updatedBy: userId,
      });
    }
  }

  const result = await upsertDemandForecasts(client, demandForecasts);

  if (result.error) {
    return json(
      {},
      await flash(
        request,
        error(result.error, "Failed to update demand forecasts")
      )
    );
  }

  return redirect(
    path.to.productionProjections + `?location=${routeLocationId}`,
    await flash(request, success("Demand forecasts updated successfully"))
  );
}

export default function EditProjectionRoute() {
  const { initialValues } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  return (
    <ProductionProjectionsForm
      initialValues={initialValues}
      isEditing
      onClose={() => navigate(-1)}
    />
  );
}
