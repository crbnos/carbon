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
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceShipment
} from "~/modules/invoicing";
import {
  getSalesInvoice,
  isSalesInvoiceLocked,
  salesInvoiceValidator,
  upsertSalesInvoice
} from "~/modules/invoicing";
import type { SalesInvoiceShipmentFormRef } from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceShipmentForm";
import SalesInvoiceShipmentForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceShipmentForm";
import SalesInvoiceSummary from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceSummary";
import type { Opportunity } from "~/modules/sales";
import {
  OpportunityDocuments,
  OpportunityNotes
} from "~/modules/sales/ui/Opportunity";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const invoice = await getSalesInvoice(client, invoiceId);
  if (invoice.error) {
    throw redirect(
      path.to.salesInvoices,
      await flash(request, error(invoice.error, "Failed to load sales invoice"))
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

  // Check if SI is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "invoicing"
  });

  const invoice = await getSalesInvoice(viewClient, id);
  if (invoice.error) {
    throw redirect(
      path.to.salesInvoice(id),
      await flash(request, error(invoice.error, "Failed to load sales invoice"))
    );
  }

  await requireUnlocked({
    request,
    isLocked: isSalesInvoiceLocked(invoice.data?.status),
    redirectTo: path.to.salesInvoice(id),
    message: "Cannot modify a locked sales invoice. Reopen it first."
  });

  const { client, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const formData = await request.formData();
  const validation = await validator(salesInvoiceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { invoiceId, ...d } = validation.data;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const updateSalesInvoice = await upsertSalesInvoice(client, {
    id,
    invoiceId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateSalesInvoice.error) {
    throw redirect(
      path.to.salesInvoice(id),
      await flash(
        request,
        error(updateSalesInvoice.error, "Failed to update sales invoice")
      )
    );
  }

  throw redirect(
    path.to.salesInvoice(id),
    await flash(request, success("Updated sales invoice"))
  );
}

export default function SalesInvoiceBasicRoute() {
  const { t } = useLingui();
  const { internalNotes } = useLoaderData<typeof loader>();
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("invoiceId not found");

  const invoiceData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
    salesInvoiceShipment: SalesInvoiceShipment;
    opportunity: Opportunity;
    files: Promise<FileObject[]>;
  }>(path.to.salesInvoice(invoiceId));

  if (!invoiceData?.salesInvoice) throw new Error("salesInvoice not found");
  const { salesInvoice, salesInvoiceShipment } = invoiceData;

  if (!invoiceData) throw new Error("Could not find invoice data");

  const isReadOnly = isSalesInvoiceLocked(salesInvoice.status);

  const shipmentFormRef = useRef<SalesInvoiceShipmentFormRef>(null);

  const handleEditShippingCost = () => {
    shipmentFormRef.current?.focusShippingCost();
  };

  const initialValues = {
    id: salesInvoice.id ?? "",
    invoiceId: salesInvoice.invoiceId ?? "",
    customerId: salesInvoice.customerId ?? "",
    customerReference: salesInvoice.customerReference ?? "",
    invoiceCustomerId: salesInvoice.invoiceCustomerId ?? "",
    paymentTermId: salesInvoice.paymentTermId ?? "",
    currencyCode: salesInvoice.currencyCode ?? "",
    dateIssued: salesInvoice.dateIssued ?? "",
    dateDue: salesInvoice.dateDue ?? "",
    status: salesInvoice.status ?? ("Draft" as "Draft"),
    ...getCustomFields(salesInvoice.customFields)
  };

  const shipmentInitialValues = {
    id: salesInvoiceShipment.id,
    locationId: salesInvoiceShipment.locationId ?? "",
    shippingCost: salesInvoiceShipment.shippingCost ?? 0,
    shippingMethodId: salesInvoiceShipment.shippingMethodId ?? "",
    shippingTermId: salesInvoiceShipment.shippingTermId ?? "",
    incoterm: salesInvoiceShipment.incoterm ?? undefined,
    incotermLocation: salesInvoiceShipment.incotermLocation ?? "",
    ...getCustomFields(salesInvoiceShipment.customFields)
  };

  const { company } = useUser();

  return (
    <Fragment key={invoiceId}>
      <SalesInvoiceSummary onEditShippingCost={handleEditShippingCost} />
      <OpportunityNotes
        key={`notes-${initialValues.id}`}
        id={invoiceId}
        title={t`Notes`}
        table="salesInvoice"
        internalNotes={internalNotes}
      />
      <DeferredFiles key={`documents-${invoiceId}`} resolve={invoiceData.files}>
        {(resolvedFiles) => (
          <OpportunityDocuments
            opportunity={invoiceData.opportunity}
            attachments={resolvedFiles}
            id={invoiceId}
            type="Sales Invoice"
            isReadOnly={isReadOnly}
          />
        )}
      </DeferredFiles>
      <SalesInvoiceShipmentForm
        key={`shipment-${invoiceId}`}
        ref={shipmentFormRef}
        initialValues={shipmentInitialValues}
        currencyCode={initialValues.currencyCode || company.baseCurrencyCode}
        defaultCollapsed={false}
      />
    </Fragment>
  );
}
