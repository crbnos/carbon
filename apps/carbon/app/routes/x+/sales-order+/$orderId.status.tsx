import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { salesOrderStatusType, updateSalesOrderStatus } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path, requestReferrer } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { orderId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof salesOrderStatusType)[number];

  if (!status || !salesOrderStatusType.includes(status)) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updateSalesOrderStatus(client, {
    id,
    status,
    assignee: ["Closed"].includes(status) ? null : undefined,
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.quote(id),
      await flash(
        request,
        error(update.error, "Failed to update sales order status")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(request, success("Updated sales order status"))
  );
}
