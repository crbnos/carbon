import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deletePurchaseInvoiceLine,
  getPurchaseInvoice,
  getPurchaseInvoiceLine,
  isPurchaseInvoiceLocked
} from "~/modules/invoicing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    delete: "invoicing"
  });
  const { lineId, invoiceId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!invoiceId) throw notFound("invoiceId not found");

  const purchaseInvoice = await getPurchaseInvoice(invoiceId);
  await requireUnlocked({
    request,
    isLocked: isPurchaseInvoiceLocked(purchaseInvoice.data?.status),
    redirectTo: path.to.purchaseInvoiceDetails(invoiceId),
    message: "Cannot delete lines on a confirmed purchase invoice."
  });

  const purchaseInvoiceLine = await getPurchaseInvoiceLine(lineId);
  if (purchaseInvoiceLine.error) {
    throw redirect(
      path.to.purchaseInvoiceDetails(invoiceId),
      await flash(
        request,
        error(purchaseInvoiceLine.error, "Failed to get purchase invoice line")
      )
    );
  }

  return { purchaseInvoiceLine: purchaseInvoiceLine.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "invoicing"
  });

  const { lineId, invoiceId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!invoiceId) throw notFound("Could not find invoiceId");

  const purchaseInvoice = await getPurchaseInvoice(invoiceId);
  await requireUnlocked({
    request,
    isLocked: isPurchaseInvoiceLocked(purchaseInvoice.data?.status),
    redirectTo: path.to.purchaseInvoiceDetails(invoiceId),
    message: "Cannot delete lines on a confirmed purchase invoice."
  });

  const { error: deleteTypeError } = await deletePurchaseInvoiceLine(lineId);
  if (deleteTypeError) {
    throw redirect(
      path.to.purchaseInvoiceDetails(invoiceId),
      await flash(
        request,
        error(deleteTypeError, "Failed to delete purchase invoice line")
      )
    );
  }

  throw redirect(
    path.to.purchaseInvoiceDetails(invoiceId),
    await flash(request, success("Successfully deleted purchase invoice line"))
  );
}

export default function DeletePurchaseInvoiceLineRoute() {
  const { t } = useLingui();
  const { lineId, invoiceId } = useParams();
  const { purchaseInvoiceLine } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!purchaseInvoiceLine) return null;
  if (!lineId) throw notFound("Could not find lineId");
  if (!invoiceId) throw notFound("Could not find invoiceId");

  const onCancel = () => navigate(path.to.purchaseInvoiceDetails(invoiceId));

  return (
    <ConfirmDelete
      action={path.to.deletePurchaseInvoiceLine(invoiceId, lineId)}
      name={t`Purchase Invoice Line`}
      text={t`Are you sure you want to delete the purchase invoice line for ${
        purchaseInvoiceLine.quantity ?? 0
      } ${purchaseInvoiceLine.description ?? ""}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
