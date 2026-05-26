import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { isSalesInvoiceLocked } from "~/modules/invoicing";
import {
  deleteSalesInvoiceLine,
  getSalesInvoice,
  getSalesInvoiceLine
} from "~/modules/invoicing/invoicing.service.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    delete: "invoicing"
  });
  const { lineId, invoiceId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!invoiceId) throw notFound("invoiceId not found");

  const invoice = await getSalesInvoice(invoiceId);
  await requireUnlocked({
    request,
    isLocked: isSalesInvoiceLocked(invoice.data?.status),
    redirectTo: path.to.salesInvoiceDetails(invoiceId),
    message: "Cannot delete lines on a locked sales invoice."
  });

  const salesInvoiceLine = await getSalesInvoiceLine(lineId);
  if (salesInvoiceLine.error) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(
        request,
        error(salesInvoiceLine.error, "Failed to get sales invoice line")
      )
    );
  }

  return { salesInvoiceLine: salesInvoiceLine.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "invoicing"
  });

  const { lineId, invoiceId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!invoiceId) throw notFound("Could not find invoiceId");

  const invoice = await getSalesInvoice(invoiceId);
  await requireUnlocked({
    request,
    isLocked: isSalesInvoiceLocked(invoice.data?.status),
    redirectTo: path.to.salesInvoiceDetails(invoiceId),
    message: "Cannot delete lines on a locked sales invoice."
  });

  const { error: deleteTypeError } = await deleteSalesInvoiceLine(lineId);
  if (deleteTypeError) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(
        request,
        error(deleteTypeError, "Failed to delete sales invoice line")
      )
    );
  }

  throw redirect(
    path.to.salesInvoiceDetails(invoiceId),
    await flash(request, success("Successfully deleted sales invoice line"))
  );
}

export default function DeleteSalesInvoiceLineRoute() {
  const { t } = useLingui();
  const { lineId, invoiceId } = useParams();
  const { salesInvoiceLine } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!salesInvoiceLine) return null;
  if (!lineId) throw notFound("Could not find lineId");
  if (!invoiceId) throw notFound("Could not find invoiceId");

  const onCancel = () => navigate(path.to.salesInvoiceDetails(invoiceId));

  return (
    <ConfirmDelete
      action={path.to.deleteSalesInvoiceLine(invoiceId, lineId)}
      name={t`Sales Invoice Line`}
      text={t`Are you sure you want to delete the sales invoice line for ${
        salesInvoiceLine.quantity ?? 0
      } ${salesInvoiceLine.description ?? ""}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
