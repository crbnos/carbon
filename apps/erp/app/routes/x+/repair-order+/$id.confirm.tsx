import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { confirmRepairOrder } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  try {
    await confirmRepairOrder(getDatabaseClient(), { id, companyId }, userId);
  } catch (err) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(
        request,
        error(err, (err as Error)?.message ?? "Failed to confirm repair order")
      )
    );
  }

  throw redirect(
    path.to.repairOrderDetails(id),
    await flash(request, success("Repair order confirmed"))
  );
}
