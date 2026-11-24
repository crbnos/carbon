// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractRecognitionGrid,
  ContractRevenueGrid,
  ContractRevenueMigration
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
    <SetupBody>
      <SetupSection
        title={<Trans>Recognition</Trans>}
        description={
          <Trans>
            How each line earns its revenue over calendar months: spread by the
            day or evenly per month, from go-live or its start date.
          </Trans>
        }
      >
        <ContractRecognitionGrid contract={contract} lines={lines} />
      </SetupSection>
      <SetupSection
        title={<Trans>Revenue Plan</Trans>}
        description={
          <Trans>
            One row per calendar month, one column per line. A month the
            contract starts or ends part-way through gets part of the revenue.
            This is for your accounts only: invoices still bill the full amount
            of each billing period.
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
      </SetupSection>
    </SetupBody>
  );
}
