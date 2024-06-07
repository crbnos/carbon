import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import {
  QuotationLineForm,
  insertQuoteLinePrice,
  quotationLineValidator,
  upsertQuoteLine,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { id: quoteId } = params;
  if (!quoteId) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(quotationLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createQuotationLine = await upsertQuoteLine(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createQuotationLine.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(
        request,
        error(createQuotationLine.error, "Failed to create quote line.")
      )
    );
  }

  const quoteLineId = createQuotationLine.data.id;

  await insertQuoteLinePrice(client, {
    quoteId,
    quoteLineId,
    quantity: 1,
    markupPercent: 15,
    createdBy: userId,
  });

  throw redirect(path.to.quoteLine(quoteId, quoteLineId));
}

export default function NewQuotationLineRoute() {
  const { id } = useParams();

  if (!id) throw new Error("Could not find quote id");

  const initialValues = {
    quoteId: id,
    itemId: "",
    description: "",
    replenishmentSystem: "" as "Buy" | "Make",
    unitOfMeasureCode: "",
    status: "Draft" as "Draft",
  };

  return <QuotationLineForm initialValues={initialValues} />;
}
