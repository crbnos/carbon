// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuHammer } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { FleetAssetsTable } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { fleetAssetsList } from "~/utils/list-registry/accounting.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Fleet`,
  to: path.to.fleet
};

const RENTAL_FLEET_CLASS_NAME = "Rental Fleet";

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, fleetAssetsList, {
    dataKey: "data",
    firstPage: async ({ client, companyId }) => {
      // "Build for fleet" opens a new job completing to the Rental Fleet class,
      // else the first in-service class. A CIP class is never a target.
      // `getFixedAssetClassesList` does not select `isConstructionInProgress`,
      // so the filter is applied here (same select as `x+/job+/new.tsx`).
      const assetClasses = await client
        .from("fixedAssetClass")
        .select("id, name")
        .eq("companyId", companyId)
        .eq("isConstructionInProgress", false)
        .order("name");

      const classes = assetClasses.data ?? [];
      const buildForFleetClassId =
        classes.find((c) => c.name === RENTAL_FLEET_CLASS_NAME)?.id ??
        classes[0]?.id ??
        null;

      return { buildForFleetClassId };
    }
  });
}

export default function FleetRoute() {
  const { data, count, infinite, buildForFleetClassId } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <FleetAssetsTable
        data={data}
        count={count}
        infinite={infinite}
        primaryAction={
          permissions.can("create", "production") && (
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
