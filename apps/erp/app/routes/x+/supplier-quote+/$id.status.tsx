import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  supplierQuoteStatusType,
  updateSupplierQuoteStatus
} from "~/modules/purchasing";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof supplierQuoteStatusType)[number];

  if (!status || !supplierQuoteStatusType.includes(status)) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updateSupplierQuoteStatus({
    id,
    status,
    assignee: undefined,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.supplierQuote(id),
      await flash(
        request,
        error(update.error, "Failed to update supplier quote status")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.supplierQuote(id),
    await flash(request, success("Updated supplier quote status"))
  );
}
