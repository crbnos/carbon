import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { updatePurchaseInvoiceStatus } from "~/modules/invoicing";
import { purchaseInvoiceStatusType } from "~/modules/invoicing/invoicing.models";
import { getCompanySettings } from "~/modules/settings";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  // Read the base table, not the purchaseInvoices view — the view derives
  // status/datePaid from settlements, but the manual transitions below key
  // on the stored base status.
  const invoice = await client
    .from("purchaseInvoice")
    .select("status, datePaid, postingDate")
    .eq("id", id)
    .single();

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

  // Manual Paid (and its revert) is the settled signal for companies without
  // accounting. With accounting enabled, invoices settle only via payments so
  // the subledger stays tied to the GL.
  let datePaid: string | null | undefined;
  const isMarkingPaid = status === "Paid";
  const isReverting = invoice.data.status === "Paid" && status === "Open";

  if (isMarkingPaid || isReverting) {
    const companySettings = await getCompanySettings(client, companyId);
    const accountingEnabled =
      (companySettings.data as { accountingEnabled?: boolean } | null)
        ?.accountingEnabled ?? false;

    if (accountingEnabled) {
      throw redirect(
        requestReferrer(request) ?? path.to.purchaseInvoiceDetails(id),
        await flash(
          request,
          error(
            null,
            "Invoices are settled by payments when accounting is enabled"
          )
        )
      );
    }

    if (isMarkingPaid && invoice.data.status !== "Open") {
      throw redirect(
        requestReferrer(request) ?? path.to.purchaseInvoiceDetails(id),
        await flash(
          request,
          error(null, "Only open invoices can be marked as paid")
        )
      );
    }

    datePaid = isMarkingPaid ? new Date().toISOString().slice(0, 10) : null;
  }

  const update = await updatePurchaseInvoiceStatus(client, {
    id,
    status,
    assignee: !["Partially Paid"].includes(status) ? null : undefined,
    updatedBy: userId,
    ...(datePaid !== undefined ? { datePaid } : {})
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
    requestReferrer(request) ?? path.to.purchaseInvoiceDetails(id),
    await flash(request, success("Updated purchase invoice status"))
  );
}
