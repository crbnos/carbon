// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { Button, RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuHammer } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { FleetAssetsTable } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Fleet`,
  to: path.to.fleet
};

const RENTAL_FLEET_CLASS_NAME = "Rental Fleet";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, api } = await authorize(
    request,
    { "accounting.fleet": "View" },
    { role: "employee" }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const fleetStatus = searchParams.get("fleetStatus");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [assets, assetClasses] = await Promise.all([
    api.accounting.getFleetAssets({
      search,
      fleetStatus,
      limit,
      offset,
      sorts,
      filters
    }),
    // "Build for fleet" opens a new job completing to the Rental Fleet class,
    // else the first in-service class. A CIP class is never a target.
    // `getFixedAssetClassesList` does not select `isConstructionInProgress`,
    // so the filter is applied here (same select as `x+/job+/new.tsx`).
    client
      .from("fixedAssetClass")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("isConstructionInProgress", false)
      .order("name")
  ]);

  const classes = assetClasses.data ?? [];
  const buildForFleetClassId =
    classes.find((c) => c.name === RENTAL_FLEET_CLASS_NAME)?.id ??
    classes[0]?.id ??
    null;

  return {
    data: assets.data?.rows ?? [],
    count: assets.data?.count ?? 0,
    buildForFleetClassId
  };
}

export default function FleetRoute() {
  const { data, count, buildForFleetClassId } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <FleetAssetsTable
        data={data}
        count={count}
        primaryAction={
          permissions.has({ "production.jobs": "Create" }) && (
            <Button
              leftIcon={<LuHammer />}
              variant="primary"
              isDisabled={!buildForFleetClassId}
              onClick={() =>
                navigate(
                  `${path.to.newJob}?fixedAssetClassId=${buildForFleetClassId}`
                )
              }
            >
              <Trans>Build for Fleet</Trans>
            </Button>
          )
        }
      />
      <RecordOutlet />
    </VStack>
  );
}
