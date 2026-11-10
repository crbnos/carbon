// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { PickingList } from "~/modules/inventory/ui/PickingLists";
import { PickingListsTable } from "~/modules/inventory/ui/PickingLists";
import type { Handle } from "~/utils/handle";
import { pickingListsList } from "~/utils/list-registry/inventory.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["pickingList"],
  breadcrumb: msg`Picking Lists`,
  to: path.to.pickingLists
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, pickingListsList, {
    dataKey: "pickingLists",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading picking lists"
    }
  });
}

export default function PickingListsRoute() {
  const { pickingLists, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PickingListsTable
        data={pickingLists as PickingList[]}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
