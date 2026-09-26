import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateSalesRFQLineOrder } from "~/modules/sales";
import { parseSortOrderUpdates } from "~/modules/shared/sort-order";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  if (!params.rfqId) throw new Error("Could not find rfqId");

  const updates = parseSortOrderUpdates(await request.formData());
  if (!updates) {
    return data(
      { success: false },
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  try {
    await updateSalesRFQLineOrder(
      getDatabaseClient(),
      companyId,
      userId,
      params.rfqId,
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
