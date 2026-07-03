import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { updateSalesInvoiceStatus } from "~/modules/invoicing";
import { salesInvoiceStatusType } from "~/modules/invoicing/invoicing.models";
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
  ) as (typeof salesInvoiceStatusType)[number];

  if (!status || !salesInvoiceStatusType.includes(status)) {
    throw redirect(
      path.to.salesInvoiceDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // Read the base table, not the salesInvoices view — the view derives
  // status/datePaid from settlements, but the manual transitions below key
  // on the stored base status.
  const invoice = await client
    .from("salesInvoice")
    .select("status, datePaid, postingDate")
    .eq("id", id)
    .single();

  if (invoice.error || !invoice.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesInvoiceDetails(id),
      await flash(request, error(invoice.error, "Failed to get sales invoice"))
    );
  }

  if (!invoice.data.postingDate) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesInvoiceDetails(id),
      await flash(
        request,
        error(
          null,
          "Cannot update status of draft sales invoice. Please post the invoice first."
        )
      )
    );
  }

  // Manual Paid (and its revert) is the settled signal for companies without
  // accounting. With accounting enabled, invoices settle only via payments so
  // the subledger stays tied to the GL.
  let datePaid: string | null | undefined;
  const isMarkingPaid = status === "Paid";
  const isReverting = invoice.data.status === "Paid" && status === "Submitted";

  if (isMarkingPaid || isReverting) {
    const companySettings = await getCompanySettings(client, companyId);
    const accountingEnabled =
      (companySettings.data as { accountingEnabled?: boolean } | null)
        ?.accountingEnabled ?? false;

    if (accountingEnabled) {
      throw redirect(
        requestReferrer(request) ?? path.to.salesInvoiceDetails(id),
        await flash(
          request,
          error(
            null,
            "Invoices are settled by payments when accounting is enabled"
          )
        )
      );
    }

    if (isMarkingPaid && invoice.data.status !== "Submitted") {
      throw redirect(
        requestReferrer(request) ?? path.to.salesInvoiceDetails(id),
        await flash(
          request,
          error(null, "Only submitted invoices can be marked as paid")
        )
      );
    }

    datePaid = isMarkingPaid ? new Date().toISOString().slice(0, 10) : null;
  }

  const update = await updateSalesInvoiceStatus(client, {
    id,
    status,
    assignee: !["Partially Paid"].includes(status) ? null : undefined,
    updatedBy: userId,
    ...(datePaid !== undefined ? { datePaid } : {})
  });

  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesInvoiceDetails(id),
      await flash(
        request,
        error(update.error, "Failed to update sales invoice status")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.salesInvoiceDetails(id),
    await flash(request, success("Updated sales invoice status"))
  );
}
