import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getInventoryCount } from "~/modules/inventory";
import { path } from "~/utils/path";

// Roll Back (Posted -> Voided): atomically reverses every posted adjustment.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const header = await getInventoryCount(client, id, companyId);
  if (header.data?.status !== "Posted") {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(
        request,
        error(null, "Only a posted count can be rolled back")
      )
    );
  }

  const serviceRole = getCarbonServiceRole();
  const result = await serviceRole.functions.invoke("post-inventory-count", {
    body: { type: "void", inventoryCountId: id, userId, companyId }
  });

  if (result.error) {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(request, error(result.error, "Failed to roll back"))
    );
  }

  throw redirect(
    path.to.inventoryCount(id),
    await flash(request, success("Inventory count rolled back"))
  );
}
