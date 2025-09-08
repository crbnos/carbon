import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getProductionProjections } from "~/modules/production";
import DemandForecastsTable from "~/modules/production/ui/Forecast/DemandForecastTable";

import { getLocationsList } from "~/modules/resources";
import { getPeriods } from "~/modules/shared/shared.service";
import { getUserDefaults } from "~/modules/users/users.server";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Forecasts",
  to: path.to.demandForecasts,
};

export const WEEKS_TO_PROJECT = 12 * 4;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
    bypassRls: true,
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.production,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const startDate = startOfWeek(today(getLocalTimeZone()), "en-US");
  const endDate = startDate.add({ weeks: WEEKS_TO_PROJECT });
  const periods = await getPeriods(client, {
    startDate: startDate.toString(),
    endDate: endDate.toString(),
  });

  if (periods.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(periods.error, "Failed to load periods"))
    );
  }

  const projections = await getProductionProjections(
    client,
    locationId,
    periods.data?.map((p) => p.id) ?? [],
    companyId,
    {
      search,
      limit,
      offset,
      sorts,
      filters,
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

  return json({
    projections: projections.data ?? [],
    count: projections.data?.length ?? 0,
    locationId,
    periods: periods.data ?? [],
  });
}

export default function DemandForecastsRoute() {
  const { projections, count, locationId, periods } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <DemandForecastsTable
        data={projections}
        count={count}
        locationId={locationId}
        periods={periods}
      />
      <Outlet />
    </VStack>
  );
}
