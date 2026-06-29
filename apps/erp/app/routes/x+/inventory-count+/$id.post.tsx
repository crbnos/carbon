import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getInventoryCount } from "~/modules/inventory";
import { path } from "~/utils/path";

// Post (Pending -> Posted): atomically posts the variance as inventory
// adjustments via the edge function.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const header = await getInventoryCount(client, id, companyId);
  if (header.data?.status !== "Pending") {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(
        request,
        error(null, "Only a confirmed (pending) count can be made effective")
      )
    );
  }

  const serviceRole = getCarbonServiceRole();
  const post = await serviceRole.functions.invoke("post-inventory-count", {
    body: { type: "post", inventoryCountId: id, userId, companyId }
  });

  if (post.error) {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(request, error(post.error, "Failed to post inventory count"))
    );
  }

  throw redirect(
    path.to.inventoryCount(id),
    await flash(request, success("Inventory count posted"))
  );
}
