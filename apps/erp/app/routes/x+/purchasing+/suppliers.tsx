// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SuppliersTable } from "~/modules/purchasing/ui/Supplier";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import {
  suppliersList,
  withSupplierReportContacts
} from "~/utils/list-registry/purchasing.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["supplier"],
  breadcrumb: msg`Suppliers`,
  to: path.to.suppliers
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, suppliersList, {
    dataKey: "suppliers",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => ({
      tags: (await getTagsList(client, companyId, "supplier")).data ?? []
    }),
    // The report contacts of each page's suppliers, for the CSV export.
    mapRows: withSupplierReportContacts,
    onError: {
      redirectTo: path.to.purchasing,
      message: "Failed to fetch suppliers"
    }
  });
}

export default function PurchasingSuppliersRoute() {
  const { count, suppliers, nextCursor, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SuppliersTable
        data={suppliers}
        count={count}
        nextCursor={nextCursor}
        tags={tags}
      />
      <RecordOutlet />
    </VStack>
  );
}
