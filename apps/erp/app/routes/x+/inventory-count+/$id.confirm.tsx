import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { transitionInventoryCountStatus } from "~/modules/inventory/inventory-transitions.server";
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

  const result = await transitionInventoryCountStatus(client, {
    id,
    companyId,
    userId,
    status: "Pending"
  });

  if (result.error) {
    throw redirect(
      result.error.message === "Inventory count not found"
        ? path.to.inventoryCounts
        : path.to.inventoryCount(id),
      await flash(request, error(result.cause, result.error.message))
    );
  }

  throw redirect(
    path.to.inventoryCount(id),
    await flash(request, success("Count confirmed"))
  );
}
