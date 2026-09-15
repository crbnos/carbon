import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createReplacementPurchaseOrder } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing"
    });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await createReplacementPurchaseOrder(client, {
    purchaseReturnOrderId: id,
    companyId,
    companyGroupId,
    userId
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.purchaseReturnOrderDetails(id),
      await flash(
        request,
        error(result.error, "Failed to create replacement purchase order")
      )
    );
  }

  throw redirect(
    path.to.purchaseOrder(result.data.id),
    await flash(request, success("Created replacement purchase order"))
  );
}
