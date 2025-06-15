import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { runMRP } from "~/modules/production";
import {
  purchaseOrderStatusType,
  updatePurchaseOrderStatus,
} from "~/modules/purchasing";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const { orderId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof purchaseOrderStatusType)[number];

  if (!status || !purchaseOrderStatusType.includes(status)) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const [update] = await Promise.all([
    updatePurchaseOrderStatus(client, {
      id,
      status,
      assignee: ["Closed"].includes(status) ? null : undefined,
      updatedBy: userId,
    }),
  ]);
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.quote(id),
      await flash(
        request,
        error(update.error, "Failed to update purchasing order status")
      )
    );
  }

  if (status === "Planned") {
    await runMRP(getCarbonServiceRole(), {
      type: "purchaseOrder",
      id,
      companyId,
      userId,
    });
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(request, success("Updated purchasing order status"))
  );
}
