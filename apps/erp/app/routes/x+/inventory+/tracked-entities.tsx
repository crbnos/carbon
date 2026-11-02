// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import TrackedEntitiesTable from "~/modules/inventory/ui/Traceability/TrackedEntitiesTable";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { trackedEntitiesList } from "~/utils/list-registry/inventory.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["trackedEntity"],
  breadcrumb: msg`Tracked Entities`,
  to: path.to.trackedEntities
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, trackedEntitiesList, {
    dataKey: "trackedEntities",
    firstPage: async ({ client, companyId }) => {
      const companySettings = await getCompanySettings(client, companyId);
      const inventoryShelfLife = companySettings.data?.inventoryShelfLife as {
        nearExpiryWarningDays?: number | null;
      } | null;
      return {
        nearExpiryWarningDays: inventoryShelfLife?.nearExpiryWarningDays ?? null
      };
    },
    // The shelf-life policy of each row's item, so the Expiry trace popover
    // can render the Policy step without an extra round-trip per row.
    mapRows: async (trackedEntities, { client }) => {
      const itemIds = Array.from(
        new Set(
          trackedEntities
            .map((te) => te.itemId)
            .filter((id): id is string => !!id)
        )
      );
      const shelfLifeRows =
        itemIds.length > 0
          ? await client
              .from("itemShelfLife")
              .select("itemId, mode, days, calculateFromBom")
              .in("itemId", itemIds)
          : { data: [] };
      const policyByItemId = new Map(
        (shelfLifeRows.data ?? []).map((row) => [
          row.itemId,
          {
            mode: row.mode,
            days: row.days ?? null,
            calculateFromBom: row.calculateFromBom ?? false
          }
        ])
      );
      return trackedEntities.map((te) => ({
        ...te,
        shelfLifePolicy: (te.itemId && policyByItemId.get(te.itemId)) || null
      }));
    },
    onError: {
      redirectTo: path.to.inventory,
      message: "Error loading tracked entities"
    }
  });
}

export default function TraceabilityRoute() {
  const { trackedEntities, count, infinite, nearExpiryWarningDays } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrackedEntitiesTable
        data={trackedEntities}
        count={count}
        infinite={infinite}
        nearExpiryWarningDays={nearExpiryWarningDays ?? null}
      />
    </VStack>
  );
}
