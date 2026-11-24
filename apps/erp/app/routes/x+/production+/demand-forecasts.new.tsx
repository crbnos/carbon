// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteData, useRouteDialog } from "@carbon/react";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  demandProjectionValidator,
  demandProjectionWeeks
} from "~/modules/production/production.models";
import DemandProjectionForm from "~/modules/production/ui/DemandProjection/DemandProjectionForm";
import {
  getCompanyTimeZone,
  getOrCreatePeriods
} from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const WEEKS_TO_PROJECT = 52;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "production"
  });

  // No location yet — it is picked in the form — so the week grid anchors on
  // the company calendar.
  const periods = await getOrCreatePeriods(
    getDatabaseClient(),
    datetime.today(await getCompanyTimeZone(client, companyId)),
    WEEKS_TO_PROJECT
  );

  return { periods };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(demandProjectionValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { itemId, locationId } = input.data;
  const api = await carbon(args.request);
  const result = await api.production.createDemandProjections({
    itemId,
    locationId,
    weeks: demandProjectionWeeks(input.data)
  });
  return respond(args.request, result).redirect(
    `${path.to.demandProjections}?location=${locationId}`,
    { message: "Demand forecasts created successfully" }
  );
}

export default function NewProjectionRoute() {
  const dialog = useRouteDialog();
  const routeData = useRouteData<{
    locationId: string;
  }>(path.to.demandProjections);

  const initialValues = {
    itemId: "",
    locationId: routeData?.locationId ?? "",
    ...Object.fromEntries(Array.from({ length: 52 }, (_, i) => [`week${i}`, 0]))
  };

  return (
    <DemandProjectionForm
      open={dialog.open}
      onClose={dialog.close}
      initialValues={initialValues}
    />
  );
}
