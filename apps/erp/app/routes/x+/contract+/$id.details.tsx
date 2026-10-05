// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { draftContractSetupPath } from "~/modules/sales/sales.server";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractAmendments,
  ContractInvoices,
  ContractRevenue,
  ContractSummary
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

/** A Draft is worked on in its setup wizard, so its page sends an editor
 *  there — including Create Contract on a sales order and every action that
 *  returns to the contract page. A viewer who cannot edit sees the page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "sales"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const setup = await draftContractSetupPath(client, {
    companyId,
    userId,
    id
  });
  if (setup) throw redirect(setup);
  return null;
}

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
    revenue,
    revenueRows,
    revenueIsStored,
    revenueResiduals
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
      />
      <ContractRevenue
        contract={contract}
        lines={lines}
        schedule={schedule}
        credits={credits}
        revenue={revenue}
        revenueRows={revenueRows}
        revenueIsStored={revenueIsStored}
        revenueResiduals={revenueResiduals}
      />
      <ContractAmendments
        contract={contract}
        lines={lines}
        amendments={amendments}
      />
    </>
  );
}
