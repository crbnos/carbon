// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractRecognitionGrid,
  ContractRevenueGrid,
  ContractRevenueMigration,
  ContractSetupBody,
  ContractSetupSection
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

/** Setup step 4: how each line's revenue is recognized, month by month. */
export default function ContractSetupRevenueRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  if (!routeData) return null;
  const { contract, lines, revenueRows, revenueIsStored, revenueResiduals } =
    routeData;

  return (
    <ContractSetupBody>
      <ContractSetupSection
        title={<Trans>Recognition</Trans>}
        description={
          <Trans>
            How each line earns its revenue: spread by the day or evenly per
            month, from go-live or its start date.
          </Trans>
        }
      >
        <ContractRecognitionGrid contract={contract} lines={lines} />
      </ContractSetupSection>
      <ContractSetupSection
        title={<Trans>Revenue Plan</Trans>}
        description={
          <Trans>
            One row per month, one column per line. Each line recognizes exactly
            what its invoices bill.
          </Trans>
        }
      >
        <ContractRevenueGrid
          contract={contract}
          lines={lines}
          revenueRows={revenueRows}
          revenueIsStored={revenueIsStored}
          revenueResiduals={revenueResiduals}
        />
        <ContractRevenueMigration contract={contract} />
      </ContractSetupSection>
    </ContractSetupBody>
  );
}
