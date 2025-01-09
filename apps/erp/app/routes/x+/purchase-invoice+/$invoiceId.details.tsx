import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { Await, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { Fragment } from "react/jsx-runtime";
import { useRouteData } from "~/hooks";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "~/modules/invoicing";
import {
  PurchaseInvoiceSummary,
  purchaseInvoiceValidator,
  upsertPurchaseInvoice,
} from "~/modules/invoicing";
import type { SupplierInteraction } from "~/modules/purchasing";
import {
  SupplierInteractionDocuments,
  SupplierInteractionNotes,
} from "~/modules/purchasing/ui/SupplierInteraction";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "invoicing",
  });

  const { invoiceId: id } = params;
  if (!id) throw new Error("Could not find invoiceId");

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { invoiceId, ...data } = validation.data;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const updatePurchaseInvoice = await upsertPurchaseInvoice(client, {
    id,
    invoiceId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updatePurchaseInvoice.error) {
    throw redirect(
      path.to.purchaseInvoice(id),
      await flash(
        request,
        error(updatePurchaseInvoice.error, "Failed to update purchase invoice")
      )
    );
  }

  throw redirect(
    path.to.purchaseInvoice(id),
    await flash(request, success("Updated purchase invoice"))
  );
}

export default function PurchaseInvoiceBasicRoute() {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const invoiceData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    purchaseInvoiceLines: PurchaseInvoiceLine[];
    interaction: SupplierInteraction;
    files: Promise<FileObject[]>;
  }>(path.to.purchaseInvoice(invoiceId));

  if (!invoiceData?.purchaseInvoice)
    throw new Error("purchaseInvoice not found");
  const { purchaseInvoice } = invoiceData;

  if (!invoiceData) throw new Error("Could not find invoice data");

  const initialValues = {
    id: purchaseInvoice.id ?? "",
    invoiceId: purchaseInvoice.invoiceId ?? "",
    supplierId: purchaseInvoice.supplierId ?? "",
    supplierReference: purchaseInvoice.supplierReference ?? "",
    invoiceSupplierId: purchaseInvoice.invoiceSupplierId ?? "",
    paymentTermId: purchaseInvoice.paymentTermId ?? "",
    currencyCode: purchaseInvoice.currencyCode ?? "",
    dateIssued: purchaseInvoice.dateIssued ?? "",
    dateDue: purchaseInvoice.dateDue ?? "",
    status: purchaseInvoice.status ?? ("Draft" as "Draft"),
    ...getCustomFields(purchaseInvoice.customFields),
  };

  return (
    <Fragment key={invoiceId}>
      <PurchaseInvoiceSummary />
      <SupplierInteractionNotes
        key={`notes-${initialValues.id}`}
        id={invoiceId}
        title="Notes"
        table="purchaseInvoice"
        internalNotes={purchaseInvoice.internalNotes as JSONContent}
      />
      <Suspense
        key={`documents-${invoiceId}`}
        fallback={
          <div className="flex w-full min-h-[480px] h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="h-10 w-10" />
          </div>
        }
      >
        <Await resolve={invoiceData.files}>
          {(resolvedFiles) => (
            <SupplierInteractionDocuments
              interactionId={invoiceData.interaction.id}
              attachments={resolvedFiles}
              id={invoiceId}
              type="Purchase Invoice"
            />
          )}
        </Await>
      </Suspense>
    </Fragment>
  );
}
