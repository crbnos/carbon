import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getInventoryCount,
  updateInventoryCountStatus
} from "~/modules/inventory";
import { path } from "~/utils/path";

// Confirm (Draft -> Pending): moves the count out of entry into review. The
// acknowledgement of row-level warnings happens in the confirm dialog.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const header = await getInventoryCount(client, id, companyId);
  if (header.error || !header.data) {
    throw redirect(
      path.to.inventoryCounts,
      await flash(request, error(header.error, "Inventory count not found"))
    );
  }

  if (header.data.status !== "Draft") {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(request, error(null, "Only a draft count can be confirmed"))
    );
  }

  const update = await updateInventoryCountStatus(client, {
    id,
    companyId,
    status: "Pending",
    expectedStatus: "Draft",
    updatedBy: userId
  });

  if (update.error) {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(request, error(update.error, "Failed to confirm count"))
    );
  }

  throw redirect(
    path.to.inventoryCount(id),
    await flash(request, success("Count confirmed"))
  );
}
