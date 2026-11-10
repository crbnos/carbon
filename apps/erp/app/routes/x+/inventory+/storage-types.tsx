// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import StorageTypesTable from "~/modules/inventory/ui/StorageTypes/StorageTypesTable";
import type { Handle } from "~/utils/handle";
import { storageTypesList } from "~/utils/list-registry/inventory.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Storage Types`,
  to: path.to.storageTypes
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, storageTypesList, {
    dataKey: "storageTypes",
    onError: {
      redirectTo: path.to.inventory,
      message: "Error loading storage types"
    }
  });
}

export default function StorageTypesRoute() {
  const { storageTypes, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <StorageTypesTable
        data={storageTypes}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
