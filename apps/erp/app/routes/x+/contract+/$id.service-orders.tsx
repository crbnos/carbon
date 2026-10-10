// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getChildServiceProjectCosts } from "~/modules/projects";
import {
  getContractServiceOrders,
  getServiceOrderCosts
} from "~/modules/service";
import type { ContractServiceOrderRow } from "~/modules/service/ui/ServiceOrders/ContractServiceOrders";
import ContractServiceOrders from "~/modules/service/ui/ServiceOrders/ContractServiceOrders";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract-service-orders");

/** The service orders whose coverage contract is this contract, with the cost
 *  posted to each and what has been billed. Needs `service_view`; the
 *  contract page itself needs `sales_view`. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [contract, orders] = await Promise.all([
    client
      .from("customerContract")
      .select("projectId")
      .eq("id", id)
      .eq("companyId", companyId)
      .single(),
    getContractServiceOrders(client, id, companyId)
  ]);
  if (contract.error || orders.error) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(
          contract.error ?? orders.error,
          "Failed to load the contract's service orders"
        )
      )
    );
  }

  const list = orders.data ?? [];
  const contractProjectId = contract.data.projectId;

  // The contract's project rolls its orders up (one function call). A
  // contract with no project has no roll-up, so only the posted cost is read
  // (one ledger query for every order).
  const costByOrder = new Map<string, { actual: number; billed: number }>();
  const actualByProject: Record<string, number> = {};
  if (contractProjectId) {
    const costs = await getChildServiceProjectCosts(
      client,
      contractProjectId,
      companyId
    );
    if (costs.error) {
      logger.error("Failed to load the contract's service order costs", {
        companyId,
        customerContractId: id,
        error: costs.error
      });
    }
    for (const row of costs.data ?? []) {
      costByOrder.set(row.serviceOrderId, {
        actual: Number(row.actual),
        billed: Number(row.billed)
      });
    }
  } else if (list.length > 0) {
    const costs = await getServiceOrderCosts(
      client,
      list.map((order) => order.projectId),
      companyId
    );
    if (costs.error) {
      logger.error("Failed to load the contract's service order costs", {
        companyId,
        customerContractId: id,
        error: costs.error
      });
    }
    Object.assign(actualByProject, costs.data ?? {});
  }

  const rows: ContractServiceOrderRow[] = list.map((order) => {
    const rollUp = costByOrder.get(order.id);
    return {
      id: order.id,
      serviceOrderId: order.serviceOrderId,
      status: order.status,
      serial: order.trackedEntity?.readableId ?? null,
      customerAssetId: order.customerAssetId,
      site: order.customerLocation?.name ?? null,
      createdAt: order.createdAt,
      completedAt: order.completedAt,
      actual: contractProjectId
        ? (rollUp?.actual ?? null)
        : (actualByProject[order.projectId] ?? 0),
      billed: rollUp?.billed ?? null
    };
  });

  return { rows };
}

export default function ContractServiceOrdersRoute() {
  const { rows } = useLoaderData<typeof loader>();
  return <ContractServiceOrders rows={rows} />;
}
