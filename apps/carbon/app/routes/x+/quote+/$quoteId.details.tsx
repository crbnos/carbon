import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type {
  Opportunity,
  Quotation,
  QuotationPayment,
  QuotationShipment,
} from "~/modules/sales";
import {
  OpportunityDocuments,
  OpportunityNotes,
  QuoteForm,
  QuotePaymentForm,
  QuoteShipmentForm,
  quoteValidator,
  upsertQuote,
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { quoteId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(quoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { quoteId, ...data } = validation.data;
  if (!quoteId) throw new Error("Could not find quoteId");

  const update = await upsertQuote(client, {
    id,
    quoteId,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(update.error, "Failed to update quote"))
    );
  }

  throw redirect(
    path.to.quote(id),
    await flash(request, success("Updated quote"))
  );
}

export default function QuoteDetailsRoute() {
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteData = useRouteData<{
    quote: Quotation;
    files: (FileObject & { quoteLineId: string | null })[];
    shipment: QuotationShipment;
    payment: QuotationPayment;
    opportunity: Opportunity;
  }>(path.to.quote(quoteId));

  if (!quoteData) throw new Error("Could not find quote data");
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
    exchangeRateUpdatedAt: quoteData?.quote?.exchangeRateUpdatedAt ?? "",
  };

  const shipmentInitialValues = {
    id: quoteData?.shipment.id!,
    locationId: quoteData?.shipment?.locationId ?? "",
    shippingMethodId: quoteData?.shipment?.shippingMethodId ?? "",
    shippingTermId: quoteData?.shipment?.shippingTermId ?? "",
    receiptRequestedDate: quoteData?.shipment?.receiptRequestedDate ?? "",
  };

  const paymentInitialValues = {
    ...quoteData?.payment,
    invoiceCustomerId: quoteData?.payment.invoiceCustomerId ?? "",
    invoiceCustomerLocationId:
      quoteData?.payment.invoiceCustomerLocationId ?? "",
    invoiceCustomerContactId: quoteData?.payment.invoiceCustomerContactId ?? "",
    paymentTermId: quoteData?.payment.paymentTermId ?? "",
  };

  return (
    <>
      <QuoteForm key={initialValues.id} initialValues={initialValues} />
      <OpportunityDocuments
        opportunity={quoteData?.opportunity!}
        attachments={quoteData?.files ?? []}
        id={quoteId}
        type="Quote"
      />
      <QuotePaymentForm
        key={`payment-${initialValues.id}`}
        initialValues={paymentInitialValues}
      />
      <QuoteShipmentForm
        key={`shipment-${initialValues.id}`}
        initialValues={shipmentInitialValues}
      />
      <OpportunityNotes
        key={`notes-${initialValues.id}`}
        id={quoteData.quote.id}
        table="quote"
        internalNotes={quoteData.quote.internalNotes as JSONContent}
        externalNotes={quoteData.quote.externalNotes as JSONContent}
      />
    </>
  );
}
