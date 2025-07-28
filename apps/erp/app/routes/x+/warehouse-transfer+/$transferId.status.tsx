import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { warehouseTransferStatusType, updateWarehouseTransferStatus } from "~/modules/inventory";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { transferId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status") as (typeof warehouseTransferStatusType)[number];

  if (!status || !warehouseTransferStatusType.includes(status)) {
    throw redirect(
      path.to.warehouseTransfer(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updateWarehouseTransferStatus(client, id, status, userId);

  if (update.error) {
    throw redirect(
      path.to.warehouseTransfer(id),
      await flash(request, error(update.error, "Failed to update warehouse transfer status"))
    );
  }

  throw redirect(
    path.to.warehouseTransfer(id),
    await flash(request, success("Updated warehouse transfer status"))
  );
}