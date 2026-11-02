// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ReimbursementsTable } from "~/modules/invoicing/ui";
import type { Handle } from "~/utils/handle";
import { reimbursementsList } from "~/utils/list-registry/invoicing.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Reimbursements`,
  to: path.to.reimbursements,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, reimbursementsList, {
    dataKey: "data",
    onError: {
      redirectTo: path.to.invoicing,
      message: "Failed to fetch reimbursements"
    }
  });
}

export default function ReimbursementsRoute() {
  const { count, data, infinite } = useLoaderData<typeof loader>();
  // No <Outlet /> — unlike charges, the reimbursement detail is a full page of
  // its own rather than a Drawer child of this list.
  return (
    <VStack spacing={0} className="h-full">
      <ReimbursementsTable data={data} count={count} infinite={infinite} />
    </VStack>
  );
}
