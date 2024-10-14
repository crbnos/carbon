import { assertIsPost, error, success, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  generateHTML,
  HStack,
  toast,
  useThrottle,
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type {
  Opportunity,
  Quotation,
  QuotationPayment,
  QuotationShipment,
} from "~/modules/sales";
import {
  OpportunityDocuments,
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
    exchangeRateDate: quoteData?.quote?.exchangeRateDate ?? "",
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
      <QuoteNotes quote={quoteData?.quote} />
    </>
  );
}

const QuoteNotes = ({ quote }: { quote: Quotation }) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/quote/${quote.id}/${nanoid()}.${fileType}`;
    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return `/file/preview/private/${result.data.path}`;
  };

  const onUpdateExternalNotes = useThrottle(async (content: JSONContent) => {
    await carbon
      ?.from("quote")
      .update({
        externalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", quote.id!);
  }, 2500);

  const onUpdateInternalNotes = useThrottle(async (content: JSONContent) => {
    await carbon
      ?.from("quote")
      .update({
        internalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", quote.id!);
  }, 2500);

  return (
    <HStack className="w-full justify-between items-stretch">
      <Card>
        <CardHeader>
          <CardTitle>External Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {permissions.can("update", "sales") ? (
            <Editor
              initialValue={(quote.externalNotes ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={onUpdateExternalNotes}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(quote.externalNotes as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Internal Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {permissions.can("update", "sales") ? (
            <Editor
              initialValue={(quote.internalNotes ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={onUpdateInternalNotes}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(quote.internalNotes as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
    </HStack>
  );
};
