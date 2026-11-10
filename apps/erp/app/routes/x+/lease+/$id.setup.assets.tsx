// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import { LeaseAssetsGrid } from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

/** Setup step 2: the assets the lease covers, and what it pays for each. */
export default function LeaseSetupAssetsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  return (
    <SetupBody>
      <SetupSection
        title={<Trans>Assets</Trans>}
        description={
          <Trans>
            Each asset is accounted for on its own, at its own payment. Click a
            cell to change it.
          </Trans>
        }
      >
        <LeaseAssetsGrid lease={routeData.lease} lines={routeData.lines} />
      </SetupSection>
    </SetupBody>
  );
}
