import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { shipWarehouseTransfer } from "~/modules/inventory";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { transferId } = params;
  if (!transferId) throw new Response("Not found", { status: 404 });

  const result = await shipWarehouseTransfer(client, transferId, userId);

  if (result.error) {
    throw redirect(
      path.to.warehouseTransferDetails(transferId),
      await flash(
        request,
        error(result.error, "Failed to ship warehouse transfer")
      )
    );
  }

  throw redirect(
    path.to.warehouseTransferDetails(transferId),
    await flash(request, success("Warehouse transfer shipped successfully"))
  );
}