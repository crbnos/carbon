import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyTimeZone } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createRepairOrderFromReturnLine } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/**
 * The 'Repair' disposition on an RMA line.
 *
 * Mirrors how 'Return to Supplier' on a quality Issue drafts a supplier return:
 * the RMA hands the unit over and settles its own line, and the repair order
 * carries on independently. Idempotent — a second click opens the repair order
 * that already exists rather than creating another.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id || !lineId) throw new Error("Could not find id");

  const timezone = await getCompanyTimeZone(client, companyId);
  const today = datetime.today(timezone).toString();

  let result: { repairOrderId: string; created: boolean };
  try {
    result = await createRepairOrderFromReturnLine(getDatabaseClient(), {
      salesReturnOrderLineId: lineId,
      companyId,
      userId,
      today
    });
  } catch (err) {
    throw redirect(
      path.to.salesReturnOrderDetails(id),
      await flash(
        request,
        error(err, (err as Error)?.message ?? "Failed to create a repair order")
      )
    );
  }

  throw redirect(
    path.to.repairOrderDetails(result.repairOrderId),
    await flash(
      request,
      success(
        result.created
          ? "Repair order created"
          : "This unit is already on a repair order"
      )
    )
  );
}
