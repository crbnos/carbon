// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

import { deleteContractLine, getContractLine } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const line = await getContractLine(client, lineId);
  if (
    line.error ||
    line.data.companyId !== companyId ||
    line.data.customerContractId !== id
  ) {
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(null, "This line does not belong to this contract")
      )
    );
  }

  // `deleteContractLine` refuses a contract that is not a Draft — an Active
  // contract's lines end through Amend.
  // TODO(Task 15): release the sales-order line
  // (`deleteContractLineReleasingSalesOrderLine(getDatabaseClient(), …)`).
  const result = await deleteContractLine(client, lineId);
  if (result.error) {
    throw redirect(
      path.to.contractLine(id, lineId),
      await flash(
        request,
        error(result.error, result.error.message || "Failed to remove line")
      )
    );
  }

  throw redirect(
    path.to.contractDetails(id),
    await flash(request, success("Removed line from the contract"))
  );
}
