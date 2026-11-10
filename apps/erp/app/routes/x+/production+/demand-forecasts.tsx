// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { datetime, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  getProductionProjections,
  PRODUCTION_PROJECTIONS_PAGING
} from "~/modules/production/production.service";
import DemandProjectionsTable from "~/modules/production/ui/DemandProjection/DemandProjectionTable";
import ForecastUpgradeOverlay from "~/modules/production/ui/ForecastUpgradeOverlay";
import {
  getLocationTimeZone,
  getOrCreatePeriods,
  resolveLocationId
} from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import { toPage } from "~/utils/cursor";
import type { Handle } from "~/utils/handle";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "demand-forecasts");

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
  const { limit, cursor, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const locationId = await resolveLocationId(client, request, {
    searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.production,
    onNoLocations: path.to.inventory
  });

  const periods = await getOrCreatePeriods(
    getDatabaseClient(),
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
      cursor,
      sorts,
      filters
    }
  );

  if (projections.error) {
    if (cursor) {
      logger.error("Failed to load a later page of production projections", {
        companyId,
        error: projections.error
      });
      return listErrorPage("projections");
    }
    throw redirect(
      path.to.production,
      await flash(
        request,
        error(projections.error, "Failed to get production projections")
      )
    );
  }

  const page = toPage(
    projections.data ?? [],
    { limit, sorts },
    PRODUCTION_PROJECTIONS_PAGING
  );

  return {
    projections: page.rows,
    count: projections.count ?? 0,
    nextCursor: page.nextCursor,
    locationId,
    periods
  };
}

export default function DemandProjectionsRoute() {
  const { projections, count, nextCursor, locationId, periods } =
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
        nextCursor={nextCursor}
        locationId={locationId}
        periods={periods}
      />
      <RecordOutlet />
    </VStack>
  );
}
