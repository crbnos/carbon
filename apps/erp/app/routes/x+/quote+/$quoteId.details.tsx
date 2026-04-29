import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import { useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData } from "~/hooks";
import type {
  Opportunity,
  Quotation,
  QuotationPayment,
  QuotationShipment
} from "~/modules/sales";
import {
  getQuote,
  isQuoteLocked,
  quoteValidator,
  upsertQuote
} from "~/modules/sales";
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
import { requireUnlocked } from "~/utils/lockedGuard.server";
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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { quoteId: id } = params;
  if (!id) throw new Error("Could not find id");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });
  const quote = await getQuote(viewClient, id);
  await requireUnlocked({
    request,
    isLocked: isQuoteLocked(quote.data?.status),
    redirectTo: path.to.quote(id),
    message: "Cannot modify a locked quote. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(quoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { quoteId, ...d } = validation.data;
  if (!quoteId) throw new Error("Could not find quoteId");

  const update = await upsertQuote(client, {
    id,
    quoteId,
    ...d,
    customFields: setCustomFields(formData),
    updatedBy: userId
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

  const isReadOnly = isQuoteLocked(quoteData?.quote?.status);

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
            isReadOnly={isReadOnly}
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
