// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteContract, getContract } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await getContract(client, id);
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

  // TODO(Task 15): release sales-order lines — call
  // deleteContractReleasingSalesOrderLines(getDatabaseClient(), …) instead.
  const result = await deleteContract(client, id);
  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to delete contract"))
    );
  }

  throw redirect(
    path.to.contracts,
    await flash(request, success("Deleted contract"))
  );
}
