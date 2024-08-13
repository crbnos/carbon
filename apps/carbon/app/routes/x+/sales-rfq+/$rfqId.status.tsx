import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "remix-typedjson";
import { salesRFQStatusType, updateSalesRFQStatus } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status") as (typeof salesRFQStatusType)[number];

  if (!status || !salesRFQStatusType.includes(status)) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updateSalesRFQStatus(client, {
    id,
    status,
    assignee: status === "Closed" ? null : undefined,
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(update.error, "Failed to update RFQ"))
    );
  }

  throw redirect(
    path.to.salesRfq(id),
    await flash(request, success("Updated RFQ"))
  );
}
