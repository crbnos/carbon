// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { RentalAgreementsTable } from "~/modules/sales/ui/Rentals";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { rentalAgreementsList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Rental Agreements`,
  to: path.to.rentalAgreements
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, rentalAgreementsList, {
    dataKey: "rentalAgreements",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch rental agreements"
    }
  });
}

export default function RentalAgreementsRoute() {
  const { count, rentalAgreements, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <RentalAgreementsTable
        data={rentalAgreements}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
