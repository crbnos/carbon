import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  purchasingRfqStatusType,
  updatePurchasingRFQStatus
} from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
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

  const update = await updatePurchasingRFQStatus(client, {
    id,
    status,
    assignee: status === "Closed" ? null : undefined,
    updatedBy: userId
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
