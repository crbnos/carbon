import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { Quotation, QuotationAttachment } from "~/modules/sales";
import {
  QuotationDocuments,
  QuotationForm,
  quotationValidator,
  upsertQuote,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(quotationValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { quoteId, ...data } = validation.data;
  if (!quoteId) throw new Error("Could not find quoteId");

  const updateQuotation = await upsertQuote(client, {
    id: id,
    quoteId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateQuotation.error) {
    throw redirect(
      path.to.quote(id),
      await flash(
        request,
        error(updateQuotation.error, "Failed to update quote")
      )
    );
  }

  throw redirect(
    path.to.quote(id),
    await flash(request, success("Updated quote"))
  );
}

export default function QuotationBasicRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const quoteData = useRouteData<{
    quotation: Quotation;
    internalDocuments: QuotationAttachment[];
  }>(path.to.quote(id));
  if (!quoteData) throw new Error("Could not find quote data");

  const initialValues = {
    id: quoteData?.quotation?.id ?? "",
    quoteId: quoteData?.quotation?.quoteId ?? "",

    customerId: quoteData?.quotation?.customerId ?? "",
    customerContactId: quoteData?.quotation?.customerContactId ?? "",
    customerLocationId: quoteData?.quotation?.customerLocationId ?? "",
    customerReference: quoteData?.quotation?.customerReference ?? "",
    locationId: quoteData?.quotation?.locationId ?? "",
    quoteDate: quoteData?.quotation?.dueDate ?? "",
    expirationDate: quoteData?.quotation.expirationDate ?? undefined,
    status: quoteData?.quotation?.status ?? ("Draft" as "Draft"),
    notes: quoteData?.quotation?.notes ?? "",
    ...getCustomFields(quoteData.quotation.customFields),
  };

  return (
    <>
      <QuotationForm key={initialValues.id} initialValues={initialValues} />
      <QuotationDocuments
        id={id}
        attachments={quoteData.internalDocuments}
        isExternal={false}
      />
    </>
  );
}
