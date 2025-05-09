import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteSalesInvoiceLine,
  getSalesInvoiceLine,
} from "~/modules/invoicing";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "invoicing",
  });
  const { lineId, invoiceId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!invoiceId) throw notFound("invoiceId not found");

  const salesInvoiceLine = await getSalesInvoiceLine(client, lineId);
  if (salesInvoiceLine.error) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(
        request,
        error(salesInvoiceLine.error, "Failed to get sales invoice line")
      )
    );
  }

  return json({ salesInvoiceLine: salesInvoiceLine.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "invoicing",
  });

  const { lineId, invoiceId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!invoiceId) throw notFound("Could not find invoiceId");

  const { error: deleteTypeError } = await deleteSalesInvoiceLine(
    client,
    lineId
  );
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
      name="Sales Invoice Line"
      text={`Are you sure you want to delete the sales invoice line for ${
        salesInvoiceLine.quantity ?? 0
      } ${salesInvoiceLine.description ?? ""}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
