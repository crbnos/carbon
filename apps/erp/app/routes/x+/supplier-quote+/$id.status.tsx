import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { supplierQuoteStatusType } from "~/modules/purchasing";
import { updateSupplierQuoteStatus } from "~/modules/purchasing/purchasing.service.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
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
    assignee: undefined
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
