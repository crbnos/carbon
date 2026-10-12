// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getContract } from "~/modules/sales";
import { deleteContractReleasingSalesOrderLines } from "~/modules/sales/sales.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await getContract(client, id, companyId);
  if (contract.error || contract.data?.companyId !== companyId) {
    return data(
      {},
      await flash(request, error(contract.error, "Contract not found"))
    );
  }

  // A confirmed contract has a schedule and possibly invoices — it is
  // cancelled instead.
  if (contract.data.status !== "Draft") {
    return data(
      {},
      await flash(
        request,
        error(null, "Only a Draft contract can be deleted. Cancel it instead.")
      )
    );
  }

  // Hands the sales-order lines the contract took back to their order.
  try {
    await deleteContractReleasingSalesOrderLines(getDatabaseClient(), {
      companyId,
      userId,
      id
    });
  } catch (err) {
    return data(
      {},
      await flash(
        request,
        error(err, getErrorMessage(err, "Failed to delete contract"))
      )
    );
  }

  throw redirect(
    path.to.contracts,
    await flash(request, success("Deleted contract"))
  );
}
