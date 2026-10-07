// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import { useRef } from "react";
import { Fragment } from "react/jsx-runtime";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData, useUser } from "~/hooks";
import type {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceShipment
} from "~/modules/invoicing";
import {
  getInvoiceSettlementsForInvoice,
  getSalesInvoice,
  InvoicePaymentsPanel
} from "~/modules/invoicing";
import type { SalesInvoiceShipmentFormRef } from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceShipmentForm";
import SalesInvoiceShipmentForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceShipmentForm";
import SalesInvoiceSummary from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceSummary";
import type { Opportunity } from "~/modules/sales";
import {
  OpportunityDocuments,
  OpportunityNotes
} from "~/modules/sales/ui/Opportunity";
import { getCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const [invoice, applications] = await Promise.all([
    getSalesInvoice(client, invoiceId),
    getInvoiceSettlementsForInvoice(client, companyId, "sales", invoiceId)
  ]);
  if (invoice.error) {
    throw redirect(
      path.to.invoicingSales,
      await flash(request, error(invoice.error, "Failed to load sales invoice"))
    );
  }

  return {
    internalNotes: (invoice.data?.internalNotes ?? {}) as JSONContent,
    paymentApplications: applications.data ?? []
  };
}

export default function SalesInvoiceBasicRoute() {
  const { t } = useLingui();
  const { internalNotes, paymentApplications } = useLoaderData<typeof loader>();
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

  const shipmentFormRef = useRef<SalesInvoiceShipmentFormRef>(null);

  const handleEditShippingCost = () => {
    shipmentFormRef.current?.focusShippingCost();
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
      <InvoicePaymentsPanel rows={paymentApplications} />
      <OpportunityNotes
        key={`notes-${salesInvoice.id}`}
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
          />
        )}
      </DeferredFiles>
      <SalesInvoiceShipmentForm
        key={`shipment-${invoiceId}`}
        ref={shipmentFormRef}
        initialValues={shipmentInitialValues}
        currencyCode={salesInvoice.currencyCode || company.baseCurrencyCode}
        defaultCollapsed={false}
      />
    </Fragment>
  );
}
