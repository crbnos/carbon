import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { quoteStatusType } from "~/modules/sales";
import { updateQuoteStatus } from "~/modules/sales/sales.service.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "sales"
  });

  const { quoteId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status") as (typeof quoteStatusType)[number];

  if (!status || !quoteStatusType.includes(status)) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updateQuoteStatus({
    id,
    status,
    assignee: ["Closed"].includes(status) ? null : undefined
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.quote(id),
      await flash(request, error(update.error, "Failed to update quote status"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(request, success("Updated quote status"))
  );
}
