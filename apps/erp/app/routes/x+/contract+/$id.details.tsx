// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractAmendments,
  ContractInvoices,
  ContractRevenue,
  ContractSummary
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

/** The contract as a whole: what it bills, when, how its revenue falls and
 *  how it has changed. The terms are in the properties panel; a line's own
 *  page is `$lineId.details`. */
export default function ContractDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  if (!routeData) return null;

  const {
    contract,
    lines,
    schedule,
    credits,
    amendments,
    computedSchedule,
    residuals,
    revenue
  } = routeData;

  return (
    <>
      <ContractSummary
        contract={contract}
        lines={lines}
        schedule={schedule}
        computedSchedule={computedSchedule}
      />
      <ContractInvoices
        contract={contract}
        lines={lines}
        schedule={schedule}
        credits={credits}
        computedSchedule={computedSchedule}
        residuals={residuals}
      />
      <ContractRevenue contract={contract} lines={lines} revenue={revenue} />
      <ContractAmendments
        contract={contract}
        lines={lines}
        amendments={amendments}
      />
    </>
  );
}
