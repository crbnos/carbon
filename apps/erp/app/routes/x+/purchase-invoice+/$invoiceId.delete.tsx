// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deletePurchaseInvoiceReleasingLeases } from "~/modules/purchasing/purchasing.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    delete: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw notFound("invoiceId not found");

  // Draft only; a lease invoice returns the payment rows it billed to Pending.
  try {
    await deletePurchaseInvoiceReleasingLeases(getDatabaseClient(), {
      companyId,
      invoiceId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.invoicingPurchasing,
      await flash(request, error(err, "Failed to delete purchase invoice"))
    );
  }

  throw redirect(path.to.invoicingPurchasing);
}
