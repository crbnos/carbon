// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractProductsGrid,
  ContractSetupBody,
  ContractSetupSection
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

/** Setup step 2: the services the contract bills. */
export default function ContractSetupProductsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  if (!routeData) return null;
  const { contract, lines, lineTotals } = routeData;

  return (
    <ContractSetupBody>
      <ContractSetupSection
        title={<Trans>Services</Trans>}
        description={
          <Trans>
            The services this contract bills: one-time fees and recurring
            charges. Click a cell to change it.
          </Trans>
        }
      >
        <ContractProductsGrid
          contract={contract}
          lines={lines}
          lineTotals={lineTotals}
        />
      </ContractSetupSection>
    </ContractSetupBody>
  );
}
