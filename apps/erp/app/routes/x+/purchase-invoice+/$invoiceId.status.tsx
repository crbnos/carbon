import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { purchaseInvoiceStatusType } from "~/modules/invoicing/invoicing.models";
import {
  getPurchaseInvoice,
  updatePurchaseInvoiceStatus
} from "~/modules/invoicing/invoicing.service.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "invoicing"
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

  const invoice = await getPurchaseInvoice(id);

  if (invoice.error || !invoice.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.purchaseInvoiceDetails(id),
      await flash(
        request,
        error(invoice.error, "Failed to get purchase invoice")
      )
    );
  }

  if (!invoice.data.postingDate) {
    throw redirect(
      requestReferrer(request) ?? path.to.purchaseInvoiceDetails(id),
      await flash(
        request,
        error(
          null,
          "Cannot update status of draft purchase invoice. Please post the invoice first."
        )
      )
    );
  }

  const update = await updatePurchaseInvoiceStatus({
    id,
    status,
    assignee: !["Partially Paid"].includes(status) ? null : undefined
  });
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
