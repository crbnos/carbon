import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deletePurchaseOrder } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw notFound("orderId not found");

  const remove = await deletePurchaseOrder(client, orderId);

  if (remove.error) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(request, error(remove.error, remove.error.message))
    );
  }

  throw redirect(path.to.purchaseOrders);
}
