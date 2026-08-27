import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteRepairOrderCharge } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, chargeId } = params;
  if (!id || !chargeId) throw new Error("Could not find id");

  const remove = await deleteRepairOrderCharge(client, chargeId, companyId);
  if (remove.error) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(
        request,
        error(remove.error, remove.error.message ?? "Failed to delete charge")
      )
    );
  }

  throw redirect(
    path.to.repairOrderDetails(id),
    await flash(request, success("Charge deleted"))
  );
}
