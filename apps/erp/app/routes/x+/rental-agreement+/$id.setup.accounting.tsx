// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { SetupBody } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import { RentalAgreementAccounting } from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

/** Setup step 4: whether each unit is a rental or a sale. */
export default function RentalAgreementSetupAccountingRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  if (!routeData) return null;

  return (
    <SetupBody>
      <RentalAgreementAccounting
        rentalAgreement={routeData.rentalAgreement}
        lines={routeData.lines}
        leaseInputs={routeData.leaseInputs}
        leasePolicy={routeData.leasePolicy}
      />
    </SetupBody>
  );
}
