// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { createContractFromSalesOrderValidator } from "~/modules/sales";
import { createContractFromSalesOrder } from "~/modules/sales/sales.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/** Moves an order's Service lines onto a new Draft contract. The order keeps
 *  the lines, marked invoiced, so the contract bills them instead
 *  (`createContractFromSalesOrder` owns every guard). */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const validation = await validator(
    createContractFromSalesOrderValidator
  ).validate(await request.formData());
  if (validation.error) {
    return validationError(validation.error);
  }

  const asOf = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  let contractId: string;
  try {
    contractId = await createContractFromSalesOrder(getDatabaseClient(), {
      companyId,
      userId,
      asOf,
      // The order in the URL is the one the user is looking at.
      input: { ...validation.data, salesOrderId: orderId }
    });
  } catch (err) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(
        request,
        error(err, getErrorMessage(err, "Failed to create contract"))
      )
    );
  }

  throw redirect(
    path.to.contractDetails(contractId),
    await flash(request, success("Created contract"))
  );
}
