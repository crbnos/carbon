import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteWarehouseTransfer } from "~/modules/inventory/inventory.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "inventory"
  });

  const { transferId } = params;
  if (!transferId) throw new Response("Not found", { status: 404 });

  const result = await deleteWarehouseTransfer(transferId);

  if (result.error) {
    throw redirect(
      path.to.warehouseTransferDetails(transferId),
      await flash(
        request,
        error(result.error, "Failed to delete warehouse transfer")
      )
    );
  }

  throw redirect(
    path.to.warehouseTransfers,
    await flash(request, success("Warehouse transfer deleted successfully"))
  );
}
