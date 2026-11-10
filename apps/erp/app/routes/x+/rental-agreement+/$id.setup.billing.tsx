// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { SetupBody } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import { RentalAgreementBilling } from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

/** Setup step 3: how the agreement bills. */
export default function RentalAgreementSetupBillingRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  if (!routeData) return null;

  return (
    <SetupBody>
      <RentalAgreementBilling
        rentalAgreement={routeData.rentalAgreement}
        contactEmail={routeData.contactEmail}
      />
    </SetupBody>
  );
}
