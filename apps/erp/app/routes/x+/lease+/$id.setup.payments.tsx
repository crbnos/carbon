// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { SetupBody } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import {
  LeasePaymentsGrid,
  LeasePaymentTerms
} from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

/** Setup step 3: the payment terms, and each asset's payment rows cut from
 *  them. */
export default function LeaseSetupPaymentsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  return (
    <SetupBody>
      <LeasePaymentTerms lease={routeData.lease} />
      <LeasePaymentsGrid
        lease={routeData.lease}
        lines={routeData.lines}
        payments={routeData.payments}
      />
    </SetupBody>
  );
}
