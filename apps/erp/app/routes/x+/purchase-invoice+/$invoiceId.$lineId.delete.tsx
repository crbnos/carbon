// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { isPurchaseInvoiceLocked } from "~/modules/invoicing/invoicing.models";
import {
  getPurchaseInvoice,
  getPurchaseInvoiceLine
} from "~/modules/invoicing/invoicing.service";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "invoicing"
  });
  const { lineId, invoiceId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!invoiceId) throw notFound("invoiceId not found");

  const purchaseInvoice = await getPurchaseInvoice(client, invoiceId);
  await requireUnlocked({
    request,
    isLocked: isPurchaseInvoiceLocked(purchaseInvoice.data?.status),
    redirectTo: path.to.purchaseInvoiceDetails(invoiceId),
    message: "Cannot delete lines on a confirmed purchase invoice."
  });

  const purchaseInvoiceLine = await getPurchaseInvoiceLine(client, lineId);
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["invoiceId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { invoiceId, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.invoicing.deleteDraftPurchaseInvoiceLine({
    invoiceId,
    lineId
  });
  return respond(args.request, result).redirect(
    path.to.purchaseInvoiceDetails(invoiceId),
    { message: "Successfully deleted purchase invoice line" }
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
