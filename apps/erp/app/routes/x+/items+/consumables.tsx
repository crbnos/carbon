// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ConsumablesTable } from "~/modules/items/ui/Consumables";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { consumablesList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["item"],
  breadcrumb: msg`Consumables`,
  to: path.to.consumables
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, consumablesList, {
    dataKey: "consumables",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => ({
      tags: (await getTagsList(client, companyId, "consumable")).data ?? []
    }),
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch consumables"
    }
  });
}

export default function ConsumablesSearchRoute() {
  const { count, consumables, infinite, tags } = useLoaderData<typeof loader>();
  useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ConsumablesTable
        data={consumables}
        count={count}
        infinite={infinite}
        tags={tags}
      />
      <RecordOutlet />
    </VStack>
  );
}
