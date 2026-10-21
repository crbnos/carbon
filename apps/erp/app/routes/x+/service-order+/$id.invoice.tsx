// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { createServiceOrderInvoice } from "~/modules/service/service.service";
import { invokePosting } from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-order-invoice");

/**
 * Drafts the invoice of a Completed service order from its Unbilled items
 * (`create-service-order-invoice`), which also closes the order, then opens
 * the Draft invoice.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "service",
    create: "invoicing"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await invokePosting(
    { db: getDatabaseClient(), companyId, userId },
    "create-service-order-invoice",
    { serviceOrderId: id },
    createServiceOrderInvoice
  );
  if (result.error || !result.data) {
    logger.error("Failed to invoice a service order", {
      companyId,
      serviceOrderId: id,
      error: result.error
    });
    throw redirect(
      path.to.serviceOrderBilling(id),
      await flash(
        request,
        error(
          result.error,
          result.error?.message || "Failed to create the invoice"
        )
      )
    );
  }

  throw redirect(
    path.to.salesInvoiceDetails(result.data.salesInvoiceId),
    await flash(request, success(`Invoice ${result.data.invoiceId} drafted`))
  );
}
