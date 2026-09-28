import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { salesOrderStatusType } from "~/modules/sales";
import { transitionSalesOrderStatus } from "~/modules/sales/sales-transitions.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { orderId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof salesOrderStatusType)[number];

  if (!status || !salesOrderStatusType.includes(status)) {
    throw redirect(
      path.to.salesOrderDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // The modal sends "cancelJobIds" as a comma-separated string. The presence
  // of the field (even when empty) signals "user explicitly chose which
  // jobs". Absence signals "no preference — cancel all".
  const cancelJobIdsRaw = formData.get("cancelJobIds") as string | null;
  const cancelJobIds =
    cancelJobIdsRaw === null
      ? undefined
      : cancelJobIdsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  const result = await transitionSalesOrderStatus(client, {
    id,
    userId,
    status,
    cancelJobIds
  });
  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesOrderDetails(id),
      await flash(
        request,
        result.cause
          ? error(result.cause, result.error.message)
          : error(null, result.error.message)
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(
      request,
      success(result.data?.message ?? "Updated sales order status")
    )
  );
}
