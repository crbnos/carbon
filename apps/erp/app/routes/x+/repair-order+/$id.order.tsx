import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createRepairSalesOrder } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { create: "sales" });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  let result: { data: { id: string } | null; error: unknown };
  try {
    result = await createRepairSalesOrder(client, getDatabaseClient(), {
      repairOrderId: id,
      companyId,
      companyGroupId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(request, error(err, (err as Error)?.message ?? "Failed"))
    );
  }

  if (result.error || !result.data) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(request, error(result.error, "Failed to create the document"))
    );
  }

  throw redirect(
    path.to.repairOrderDetails(id),
    await flash(request, success("Sales order created from billable charges"))
  );
}
