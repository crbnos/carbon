// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { datetime, redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { getProjectContractRevenue } from "~/modules/projects";
import {
  getContractLineFunding,
  getContractProjectBillingInvoices
} from "~/modules/sales";
import { draftContractSetupPath } from "~/modules/sales/sales.server";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import {
  ContractAmendments,
  ContractInvoices,
  ContractProjectBilling,
  ContractRevenue,
  ContractSummary
} from "~/modules/sales/ui/Contracts";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract-details");

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

  // Project billing (Phase 4a): the billing lines' funding on the company's
  // today, the invoices that billed them and the revenue recognized for them
  // (Phase 4b). Nothing for a contract with no Time & Materials or Cost Plus
  // line.
  const billingLines = await client
    .from("customerContractLine")
    .select("id")
    .eq("customerContractId", id)
    .eq("companyId", companyId)
    .neq("billingMethod", "Fixed");
  const lineIds = (billingLines.data ?? []).map((line) => line.id);
  if (lineIds.length === 0) {
    return { projectBilling: null };
  }

  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const [funding, invoices, revenue] = await Promise.all([
    getContractLineFunding(client, { companyId, lineIds, asOf }),
    getContractProjectBillingInvoices(client, {
      companyId,
      customerContractId: id
    }),
    getProjectContractRevenue(client, { companyId, lineIds })
  ]);
  if (billingLines.error || funding.error || invoices.error || revenue.error) {
    logger.error("Failed to load a contract's project billing", {
      companyId,
      customerContractId: id,
      error:
        billingLines.error ?? funding.error ?? invoices.error ?? revenue.error
    });
  }

  return {
    projectBilling: {
      funding: Object.fromEntries(
        (funding.data ?? []).map((row) => [
          row.customerContractLineId,
          {
            billed: Number(row.billed),
            unbilled: Number(row.unbilled),
            incurred: Number(row.incurred)
          }
        ])
      ),
      invoices: invoices.data ?? [],
      revenue: revenue.data ?? {}
    }
  };
}

/** The contract as a whole: what it bills, when, how its revenue falls and
 *  how it has changed. The terms are in the properties panel; a line's own
 *  page is `$lineId.details`. */
export default function ContractDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { projectBilling } = useLoaderData<typeof loader>();
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
      {projectBilling && (
        <ContractProjectBilling
          contractId={id}
          lines={lines}
          funding={projectBilling.funding}
          invoices={projectBilling.invoices}
          revenue={projectBilling.revenue}
          currencyCode={contract.currencyCode}
        />
      )}
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
