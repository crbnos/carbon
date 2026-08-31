import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { datetime } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { getProductionProjections } from "~/modules/production";
import DemandProjectionsTable from "~/modules/production/ui/DemandProjection/DemandProjectionTable";
import ForecastUpgradeOverlay from "~/modules/production/ui/ForecastUpgradeOverlay";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getOrCreatePeriods } from "~/modules/shared/shared.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Demand Forecasts`,
  to: path.to.demandProjections
};

export const WEEKS_TO_PROJECT = 12 * 4;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const locationId = await resolveLocationId(client, request, {
    searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.production,
    onNoLocations: path.to.inventory
  });

  const periods = await getOrCreatePeriods(
    datetime.today(await getLocationTimeZone(client, locationId, companyId)),
    WEEKS_TO_PROJECT
  );

  const projections = await getProductionProjections(
    client,
    locationId,
    periods.map((p) => p.id),
    companyId,
    {
      search,
      limit,
      offset,
      sorts,
      filters
    }
  );

  if (projections.error) {
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(projections.error, "Failed to get production projections")
      )
    );
  }

  return {
    projections: projections.data ?? [],
    count: projections.data?.length ?? 0,
    locationId,
    periods
  };
}

export default function DemandProjectionsRoute() {
  const { projections, count, locationId, periods } =
    useLoaderData<typeof loader>();

  const { isGated } = usePlanGate({ feature: "FORECAST" });

  if (isGated) {
    return (
      <ForecastUpgradeOverlay
        title={<Trans>Demand Forecasts</Trans>}
        description={
          <Trans>
            Plan ahead by projecting demand per item and location, then feed it
            straight into MRP and scheduling.
          </Trans>
        }
      />
    );
  }

  return (
    <VStack spacing={0} className="h-full">
      <DemandProjectionsTable
        data={projections}
        count={count}
        locationId={locationId}
        periods={periods}
      />
      <Outlet />
    </VStack>
  );
}
