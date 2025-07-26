import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server"; 
import { flash } from "@carbon/auth/session.server";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { nanoid } from "nanoid";
import { upsertWarehouseTransfer } from "~/modules/inventory";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "New Transfer",
  to: path.to.warehouseTransfers,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory",
  });

  const defaults = await getUserDefaults(client, userId, companyId);
  
  // Generate a new transfer ID
  const transferId = `WT-${Date.now()}`;
  
  const newTransfer = await upsertWarehouseTransfer(client, {
    transferId,
    fromLocationId: defaults.data?.locationId ?? "",
    toLocationId: "",
    status: "Draft",
    companyId,
    createdBy: userId,
  });

  if (newTransfer.error || !newTransfer.data) {
    throw redirect(
      path.to.warehouseTransfers,
      await flash(request, error(newTransfer.error, "Failed to create warehouse transfer"))
    );
  }

  throw redirect(path.to.warehouseTransferDetails(newTransfer.data.id));
}