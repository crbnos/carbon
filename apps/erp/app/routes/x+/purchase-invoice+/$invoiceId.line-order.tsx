import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updatePurchaseInvoiceLineOrder } from "~/modules/invoicing";
import { parseSortOrderUpdates } from "~/modules/shared/sort-order";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  if (!params.invoiceId) throw new Error("Could not find invoiceId");

  const updates = parseSortOrderUpdates(await request.formData());
  if (!updates) {
    return data(
      { success: false },
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  try {
    await updatePurchaseInvoiceLineOrder(
      getDatabaseClient(),
      companyId,
      userId,
      params.invoiceId,
      updates
    );
  } catch (err) {
    return data(
      { success: false },
      await flash(request, error(err, "Failed to update sort order"))
    );
  }

  return { success: true };
}
