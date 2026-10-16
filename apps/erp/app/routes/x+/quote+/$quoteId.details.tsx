// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import { useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData } from "~/hooks";
import { quoteValidator } from "~/modules/sales/sales.models";
import { getQuote } from "~/modules/sales/sales.service";
import type {
  Opportunity,
  Quotation,
  QuotationPayment,
  QuotationShipment
} from "~/modules/sales/types";
import {
  OpportunityDocuments,
  OpportunityNotes,
  OpportunityState
} from "~/modules/sales/ui/Opportunity";
import {
  QuotePaymentForm,
  QuoteShipmentForm,
  QuoteSummary
} from "~/modules/sales/ui/Quotes";
import type { QuoteShipmentFormRef } from "~/modules/sales/ui/Quotes/QuoteShipmentForm";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales"
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const quote = await getQuote(client, quoteId);
  if (quote.error) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(quote.error, "Failed to load quote"))
    );
  }

  return {
    internalNotes: (quote.data?.internalNotes ?? {}) as JSONContent,
    externalNotes: (quote.data?.externalNotes ?? {}) as JSONContent
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(quoteValidator).request(args, {
    params: ["quoteId"]
  });
  if ("invalid" in input) return input.invalid;
  const { quoteId } = input.params;

  const api = await carbon(args.request);
  const result = await api.sales.updateQuoteDetails({
    ...input.data,
    id: quoteId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  return respond(args.request, result).redirect(path.to.quote(quoteId), {
    message: "Updated quote"
  });
}

export default function QuoteDetailsRoute() {
  const { t } = useLingui();
  const { internalNotes, externalNotes } = useLoaderData<typeof loader>();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteData = useRouteData<{
    quote: Quotation;
    files: Promise<FileObject[]>;
    shipment: QuotationShipment;
    payment: QuotationPayment;
    opportunity: Opportunity;
  }>(path.to.quote(quoteId));

  if (!quoteData) throw new Error("Could not find quote data");

  const shipmentFormRef = useRef<QuoteShipmentFormRef>(null);

  const handleEditShippingCost = () => {
    shipmentFormRef.current?.focusShippingCost();
  };

  const initialValues = {
    id: quoteData?.quote?.id ?? "",
    customerId: quoteData?.quote?.customerId ?? "",
    customerLocationId: quoteData?.quote?.customerLocationId ?? "",
    customerContactId: quoteData?.quote?.customerContactId ?? "",
    customerReference: quoteData?.quote?.customerReference ?? "",
    dueDate: quoteData?.quote?.dueDate ?? "",
    estimatorId: quoteData?.quote?.estimatorId ?? "",
    expirationDate: quoteData?.quote?.expirationDate ?? "",
    locationId: quoteData?.quote?.locationId ?? "",
    quoteId: quoteData?.quote?.quoteId ?? "",
    salesPersonId: quoteData?.quote?.salesPersonId ?? "",
    status: quoteData?.quote?.status ?? "Draft",
    currencyCode: quoteData?.quote?.currencyCode ?? undefined,
    exchangeRate: quoteData?.quote?.exchangeRate ?? undefined,
    exchangeRateUpdatedAt: quoteData?.quote?.exchangeRateUpdatedAt ?? ""
  };

  const shipmentInitialValues = {
    id: quoteData?.shipment.id!,
    locationId: quoteData?.shipment?.locationId ?? "",
    shippingMethodId: quoteData?.shipment?.shippingMethodId ?? "",
    shippingTermId: quoteData?.shipment?.shippingTermId ?? "",
    receiptRequestedDate: quoteData?.shipment?.receiptRequestedDate ?? "",
    shippingCost: quoteData?.shipment?.shippingCost ?? 0,
    incoterm: quoteData?.shipment?.incoterm ?? undefined,
    incotermLocation: quoteData?.shipment?.incotermLocation ?? ""
  };

  const paymentInitialValues = {
    ...quoteData?.payment,
    invoiceCustomerId: quoteData?.payment.invoiceCustomerId ?? "",
    invoiceCustomerLocationId:
      quoteData?.payment.invoiceCustomerLocationId ?? "",
    invoiceCustomerContactId: quoteData?.payment.invoiceCustomerContactId ?? "",
    paymentTermId: quoteData?.payment.paymentTermId ?? ""
  };

  return (
    <>
      <OpportunityState
        key={`state-${initialValues.id}`}
        opportunity={quoteData?.opportunity!}
      />
      <QuoteSummary key={quoteId} onEditShippingCost={handleEditShippingCost} />
      <OpportunityNotes
        key={`notes-${initialValues.id}`}
        id={quoteData.quote.id}
        title={t`Notes`}
        table="quote"
        internalNotes={internalNotes}
        externalNotes={externalNotes}
      />
      <DeferredFiles key={`documents-${quoteId}`} resolve={quoteData.files}>
        {(resolvedFiles) => (
          <OpportunityDocuments
            opportunity={quoteData.opportunity}
            attachments={resolvedFiles}
            id={quoteId}
            type="Quote"
          />
        )}
      </DeferredFiles>
      <QuotePaymentForm
        key={`payment-${initialValues.id}`}
        initialValues={paymentInitialValues}
      />
      <QuoteShipmentForm
        key={`shipment-${initialValues.id}`}
        ref={shipmentFormRef}
        initialValues={shipmentInitialValues}
      />
    </>
  );
}
