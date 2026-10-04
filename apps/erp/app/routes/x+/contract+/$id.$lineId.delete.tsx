// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

import { getContractLine } from "~/modules/sales";
import { deleteContractLineReleasingSalesOrderLine } from "~/modules/sales/sales.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  // Refuses a contract that is not a Draft — an Active contract's lines end
  // through Amend — and hands the line's sales-order line back to its order.
  try {
    await deleteContractLineReleasingSalesOrderLine(getDatabaseClient(), {
      companyId,
      userId,
      customerContractId: id,
      customerContractLineId: lineId
    });
  } catch (err) {
    throw redirect(
      path.to.contractLine(id, lineId),
      await flash(
        request,
        error(err, getErrorMessage(err, "Failed to remove line"))
      )
    );
  }

  throw redirect(
    path.to.contractDetails(id),
    await flash(request, success("Removed line from the contract"))
  );
}
