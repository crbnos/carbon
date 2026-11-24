// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  demandProjectionValidator,
  demandProjectionWeeks
} from "~/modules/production/production.models";
import { getDemandProjections } from "~/modules/production/production.service";
import DemandProjectionsForm from "~/modules/production/ui/DemandProjection/DemandProjectionForm";
import {
  getLocationTimeZone,
  getOrCreatePeriods
} from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
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
    getDatabaseClient(),
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

  // Map MRP-written consumed quantities to week indexes (display-only)
  const consumedValues: Record<number, number> = {};
  periods.forEach((period, index) => {
    const row = existingProjections.data?.find((f) => f.periodId === period.id);
    if (row?.consumedQuantity && row.consumedQuantity > 0) {
      consumedValues[index] = row.consumedQuantity;
    }
  });

  const initialValues = {
    itemId,
    locationId,
    ...weekValues
  };

  return {
    periods,
    initialValues,
    consumedValues
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(demandProjectionValidator).request(args, {
    params: ["itemId", "locationId"]
  });
  if ("invalid" in input) return input.invalid;
  const { itemId, locationId } = input.params;
  const api = await carbon(args.request);
  const result = await api.production.updateDemandProjections({
    itemId,
    locationId,
    weeks: demandProjectionWeeks(input.data)
  });
  return respond(args.request, result).redirect(
    `${path.to.demandProjections}?location=${locationId}`,
    { message: "Demand forecasts updated successfully" }
  );
}

export default function EditProjectionRoute() {
  const { initialValues, consumedValues } = useLoaderData<typeof loader>();

  const dialog = useRouteDialog();

  return (
    <DemandProjectionsForm
      initialValues={initialValues}
      consumedValues={consumedValues}
      isEditing
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
