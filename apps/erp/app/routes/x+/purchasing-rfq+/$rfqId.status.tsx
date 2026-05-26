import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { purchasingRfqStatusType } from "~/modules/purchasing";
import { updatePurchasingRFQStatus } from "~/modules/purchasing/purchasing.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "purchasing"
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof purchasingRfqStatusType)[number];

  if (!status || !purchasingRfqStatusType.includes(status)) {
    throw redirect(
      path.to.purchasingRfqDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updatePurchasingRFQStatus({
    id,
    status,
    assignee: status === "Closed" ? null : undefined
  });

  if (update.error) {
    throw redirect(
      path.to.purchasingRfqDetails(id),
      await flash(request, error(update.error, "Failed to update RFQ status"))
    );
  }

  throw redirect(
    path.to.purchasingRfqDetails(id),
    await flash(request, success("Updated RFQ status"))
  );
}
