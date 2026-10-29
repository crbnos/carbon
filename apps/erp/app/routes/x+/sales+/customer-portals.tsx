// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/auth";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  CustomerPortalsTable,
  CustomerPortalsUpgradeOverlay
} from "~/modules/sales/ui/CustomerPortals";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { customerPortalsList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Customer Portals`,
  to: path.to.customerPortals
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, customerPortalsList, {
    dataKey: "data",
    firstPage: () => ({ appUrl: getAppUrl() })
  });
}

export default function CustomerPortalsRoute() {
  const { appUrl, data, count, infinite } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "CUSTOMER_PORTALS" });

  if (isGated) {
    return <CustomerPortalsUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <CustomerPortalsTable
        appUrl={appUrl}
        data={data}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
