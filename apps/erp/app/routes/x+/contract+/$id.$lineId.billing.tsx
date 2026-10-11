// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  getContractRateCeilings,
  getIndirectPools
} from "@carbon/ee/indirect-rates.server";
import { getLogger } from "@carbon/logger";
import { datetime, redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import { getContractBillableItems } from "~/modules/projects";
import {
  getContractFundingActions,
  getContractLaborRates,
  getContractLine,
  getContractLineFunding,
  isProjectBillingMethod
} from "~/modules/sales";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import { ContractLineBilling } from "~/modules/sales/ui/Contracts";
import { getCompanySettings } from "~/modules/settings";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract-line-billing");

/** The billing of one Time & Materials or Cost Plus line: funding on the
 *  company's today, bill rates and billable items. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const line = await getContractLine(client, lineId, companyId);
  if (
    line.error ||
    line.data.customerContractId !== id ||
    !isProjectBillingMethod(line.data.billingMethod)
  ) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(line.error, "Only a Time & Materials or Cost Plus line bills")
      )
    );
  }

  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const isCostPlus = line.data.billingMethod === "Cost Plus";
  const [
    funding,
    laborRates,
    items,
    fundingActions,
    settings,
    rateCeilings,
    pools
  ] = await Promise.all([
    getContractLineFunding(client, { companyId, lineIds: [lineId], asOf }),
    getContractLaborRates(client, lineId, companyId),
    getContractBillableItems(client, {
      companyId,
      customerContractLineId: lineId
    }),
    getContractFundingActions(client, [lineId], companyId),
    getCompanySettings(client, companyId),
    isCostPlus
      ? getContractRateCeilings(client, {
          companyId,
          customerContractLineId: lineId
        })
      : null,
    isCostPlus ? getIndirectPools(client, companyId) : null
  ]);
  if (
    funding.error ||
    laborRates.error ||
    items.error ||
    fundingActions.error ||
    settings.error ||
    rateCeilings?.error ||
    pools?.error
  ) {
    logger.error("Failed to load a contract line's billing", {
      companyId,
      lineId,
      error:
        funding.error ??
        laborRates.error ??
        items.error ??
        fundingActions.error ??
        settings.error ??
        rateCeilings?.error ??
        pools?.error
    });
  }

  const position = funding.data?.[0];
  return {
    line: line.data,
    funding: {
      billed: Number(position?.billed ?? 0),
      unbilled: Number(position?.unbilled ?? 0),
      incurred: Number(position?.incurred ?? 0)
    },
    laborRates: laborRates.data ?? [],
    items: items.data ?? [],
    fundingActions: fundingActions.data ?? [],
    fundedByActions: settings.data?.timekeepingControls === "DCAA",
    rateCeilings: rateCeilings?.data ?? [],
    ceilingPools: (pools?.data ?? [])
      .filter((pool) => pool.active && pool.appliesToProjects)
      .map((pool) => ({
        id: pool.id,
        name: pool.name,
        baseType: pool.baseType
      }))
  };
}

export default function ContractLineBillingRoute() {
  const {
    line,
    funding,
    laborRates,
    items,
    fundingActions,
    fundedByActions,
    rateCeilings,
    ceilingPools
  } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const routeData = useRouteData<ContractRouteData>(
    path.to.contract(line.customerContractId)
  );
  if (!routeData) return null;
  const { contract } = routeData;

  return (
    <ContractLineBilling
      key={line.id}
      contractId={line.customerContractId}
      line={line}
      currencyCode={contract.currencyCode}
      funding={funding}
      laborRates={laborRates}
      items={items}
      fundingActions={fundingActions}
      fundedByActions={fundedByActions}
      rateCeilings={rateCeilings}
      ceilingPools={ceilingPools}
      canUpdate={
        permissions.can("update", "sales") &&
        (contract.status === "Draft" || contract.status === "Active")
      }
    />
  );
}
