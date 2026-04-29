import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import { useRef } from "react";
import { Fragment } from "react/jsx-runtime";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData, useUser } from "~/hooks";
import type {
  PurchaseInvoice,
  PurchaseInvoiceDelivery,
  PurchaseInvoiceLine
} from "~/modules/invoicing";
import {
  getPurchaseInvoice,
  isPurchaseInvoiceLocked,
  PurchaseInvoiceSummary,
  purchaseInvoiceValidator,
  upsertPurchaseInvoice
} from "~/modules/invoicing";
import { PurchaseInvoiceDeliveryForm } from "~/modules/invoicing/ui/PurchaseInvoice";
import type { PurchaseInvoiceDeliveryFormRef } from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceDeliveryForm";
import type { SupplierInteraction } from "~/modules/purchasing";
import {
  SupplierInteractionDocuments,
  SupplierInteractionNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const invoice = await getPurchaseInvoice(client, invoiceId);
  if (invoice.error) {
    throw redirect(
      path.to.purchaseInvoices,
      await flash(
        request,
        error(invoice.error, "Failed to load purchase invoice")
      )
    );
  }

  return {
    internalNotes: (invoice.data?.internalNotes ?? {}) as JSONContent
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { invoiceId: id } = params;
  if (!id) throw new Error("Could not find invoiceId");

  // Check if PI is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "invoicing"
  });

  const purchaseInvoice = await getPurchaseInvoice(viewClient, id);
  if (purchaseInvoice.error) {
    throw redirect(
      path.to.purchaseInvoice(id),
      await flash(
        request,
        error(purchaseInvoice.error, "Failed to load purchase invoice")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isPurchaseInvoiceLocked(purchaseInvoice.data?.status),
    redirectTo: path.to.purchaseInvoice(id),
    message: "Cannot modify a confirmed purchase invoice."
  });

  const { client, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { invoiceId, ...d } = validation.data;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const updatePurchaseInvoice = await upsertPurchaseInvoice(client, {
    id,
    invoiceId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
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
  const { t } = useLingui();
  const { internalNotes } = useLoaderData<typeof loader>();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const invoiceData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    purchaseInvoiceLines: PurchaseInvoiceLine[];
    purchaseInvoiceDelivery: PurchaseInvoiceDelivery;
    interaction: SupplierInteraction;
    files: Promise<FileObject[]>;
  }>(path.to.purchaseInvoice(invoiceId));

  if (!invoiceData?.purchaseInvoice)
    throw new Error("purchaseInvoice not found");
  const { purchaseInvoice, purchaseInvoiceDelivery } = invoiceData;

  if (!invoiceData) throw new Error("Could not find invoice data");

  const deliveryFormRef = useRef<PurchaseInvoiceDeliveryFormRef>(null);

  const handleEditShippingCost = () => {
    deliveryFormRef.current?.focusShippingCost();
  };

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
    ...getCustomFields(purchaseInvoice.customFields)
  };

  const deliveryInitialValues = {
    id: purchaseInvoiceDelivery.id,
    locationId: purchaseInvoiceDelivery.locationId ?? "",
    supplierShippingCost: purchaseInvoiceDelivery.supplierShippingCost ?? 0,
    shippingMethodId: purchaseInvoiceDelivery.shippingMethodId ?? "",
    shippingTermId: purchaseInvoiceDelivery.shippingTermId ?? "",
    incoterm: purchaseInvoiceDelivery.incoterm ?? undefined,
    incotermLocation: purchaseInvoiceDelivery.incotermLocation ?? "",
    ...getCustomFields(purchaseInvoiceDelivery.customFields)
  };

  const { company } = useUser();

  const isReadOnly = isPurchaseInvoiceLocked(purchaseInvoice.status);

  return (
    <Fragment key={invoiceId}>
      <PurchaseInvoiceSummary onEditShippingCost={handleEditShippingCost} />
      <SupplierInteractionNotes
        key={`notes-${initialValues.id}`}
        id={invoiceId}
        title={t`Notes`}
        table="purchaseInvoice"
        internalNotes={internalNotes}
      />
      <DeferredFiles key={`documents-${invoiceId}`} resolve={invoiceData.files}>
        {(resolvedFiles) => (
          <SupplierInteractionDocuments
            interactionId={invoiceData.interaction.id}
            attachments={resolvedFiles}
            id={invoiceId}
            type="Purchase Invoice"
            isReadOnly={isReadOnly}
          />
        )}
      </DeferredFiles>
      <PurchaseInvoiceDeliveryForm
        key={`delivery-${invoiceId}`}
        ref={deliveryFormRef}
        initialValues={deliveryInitialValues}
        currencyCode={initialValues.currencyCode || company.baseCurrencyCode}
        defaultCollapsed={false}
      />
    </Fragment>
  );
}
