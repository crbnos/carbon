import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import type { postTransactionTask } from "~/trigger/post-transaction";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  const setPendingState = await client
    .from("shipment")
    .update({
      status: "Pending",
    })
    .eq("id", shipmentId);

  if (setPendingState.error) {
    throw redirect(
      path.to.shipments,
      await flash(
        request,
        error(setPendingState.error, "Failed to post shipment")
      )
    );
  }

  await tasks.trigger<typeof postTransactionTask>("post-transactions", {
    type: "shipment",
    documentId: shipmentId,
    userId,
    companyId,
  });

  throw redirect(path.to.shipments);
}
