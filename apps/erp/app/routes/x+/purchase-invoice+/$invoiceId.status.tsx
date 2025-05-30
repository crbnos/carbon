import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { updatePurchaseInvoiceStatus } from "~/modules/invoicing";
import { purchaseInvoiceStatusType } from "~/modules/invoicing/invoicing.models";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "invoicing",
  });

  const { invoiceId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof purchaseInvoiceStatusType)[number];

  if (!status || !purchaseInvoiceStatusType.includes(status)) {
    throw redirect(
      path.to.purchaseInvoiceDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const [update] = await Promise.all([
    updatePurchaseInvoiceStatus(client, {
      id,
      status,
      assignee: !["Partially Paid"].includes(status) ? null : undefined,
      updatedBy: userId,
    }),
  ]);
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.purchaseInvoiceDetails(id),
      await flash(
        request,
        error(update.error, "Failed to update purchase invoice status")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.quote(id),
    await flash(request, success("Updated purchase invoice status"))
  );
}
