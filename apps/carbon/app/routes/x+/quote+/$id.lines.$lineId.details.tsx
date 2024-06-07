import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import {
  QuotationLineForm,
  QuotationPricing,
  getQuoteLine,
  getQuoteLinePrice,
  quotationLineValidator,
  quotationPricingValidator,
  updateQuoteLinePrice,
  upsertQuoteLine,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const [quotationLine, quotationLinePricing] = await Promise.all([
    getQuoteLine(client, lineId),
    getQuoteLinePrice(client, lineId),
  ]);

  return json({
    quotationLine: quotationLine?.data ?? null,
    quotationLinePricing: quotationLinePricing?.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const { id: quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "line") {
    const validation = await validator(quotationLineValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { id, ...data } = validation.data;

    const updateQuotationLine = await upsertQuoteLine(client, {
      id: lineId,
      ...data,
      updatedBy: userId,
      customFields: setCustomFields(formData),
    });

    if (updateQuotationLine.error) {
      throw redirect(
        path.to.quoteLine(quoteId, lineId),
        await flash(
          request,
          error(updateQuotationLine.error, "Failed to update quote line")
        )
      );
    }
  } else if (intent === "pricing") {
    const validation = await validator(quotationPricingValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const updateLinePrice = await updateQuoteLinePrice(client, {
      quoteId,
      quoteLineId: lineId,
      ...validation.data,
      updatedBy: userId,
    });

    if (updateLinePrice.error) {
      throw redirect(
        path.to.quoteLine(quoteId, lineId),
        await flash(
          request,
          error(updateLinePrice.error, "Failed to update quote line price")
        )
      );
    }
  }

  throw redirect(path.to.quoteLine(quoteId, lineId));
}

export default function EditQuotationLineRoute() {
  const { quotationLine, quotationLinePricing } =
    useLoaderData<typeof loader>();
  if (!quotationLine) throw new Error("Could not find quotation line");

  const lineInitialValues = {
    id: quotationLine?.id ?? undefined,
    quoteId: quotationLine?.quoteId ?? "",
    itemId: quotationLine?.itemId ?? "",
    description: quotationLine?.description ?? "",
    customerPartId: quotationLine?.customerPartId ?? "",
    customerPartRevision: quotationLine?.customerPartRevision ?? "",
    replenishmentSystem: (quotationLine?.replenishmentSystem ?? "") as
      | "Buy"
      | "Make",
    status: quotationLine?.status ?? "Draft",
    unitOfMeasureCode: quotationLine?.unitOfMeasureCode ?? "",
    ...getCustomFields(quotationLine?.customFields),
  };

  const pricingInitialValues = {
    quantity: quotationLinePricing?.quantity ?? 1,
    unitCost: quotationLinePricing?.unitCost ?? 0,
    leadTime: quotationLinePricing?.leadTime ?? 0,
    discountPercent: quotationLinePricing?.discountPercent ?? 0,
    markupPercent: quotationLinePricing?.markupPercent ?? 0,
    extendedPrice: quotationLinePricing?.extendedPrice ?? 0,
  };

  return (
    <>
      <QuotationLineForm
        key={`${lineInitialValues.id}-line`}
        initialValues={lineInitialValues}
      />
      <QuotationPricing
        key={`${lineInitialValues.id}-pricing`}
        initialValues={pricingInitialValues}
        isMade={quotationLine?.replenishmentSystem === "Make"}
      />
      <Outlet />
    </>
  );
}
