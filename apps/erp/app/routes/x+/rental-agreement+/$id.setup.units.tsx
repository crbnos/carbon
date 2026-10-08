// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import { RentalUnitsGrid } from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

/** Setup step 2: the fleet units the agreement rents, and each one's rate. */
export default function RentalAgreementSetupUnitsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  if (!routeData) return null;
  const { rentalAgreement, lines, rentableAssets } = routeData;

  return (
    <SetupBody>
      <SetupSection
        title={<Trans>Units</Trans>}
        description={
          <Trans>
            The fleet units this agreement rents, each at its own rate. Click a
            cell to change it.
          </Trans>
        }
      >
        <RentalUnitsGrid
          rentalAgreement={rentalAgreement}
          lines={lines}
          rentableAssets={rentableAssets}
        />
      </SetupSection>
    </SetupBody>
  );
}
