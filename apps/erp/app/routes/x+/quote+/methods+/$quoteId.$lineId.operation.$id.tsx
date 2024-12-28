import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { quoteOperationValidator, upsertQuoteOperation } from "~/modules/sales";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId, lineId, id } = params;
  if (!quoteId) {
    throw new Error("quoteId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }
  if (!id) {
    throw new Error("id not found");
  }

  const formData = await request.formData();
  const validation = await validator(quoteOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateQuoteOperation = await upsertQuoteOperation(client, {
    quoteId,
    quoteLineId: lineId,
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateQuoteOperation.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateQuoteOperation.error, "Failed to update quote operation")
      )
    );
  }

  const quoteOperationId = updateQuoteOperation.data?.id;
  if (!quoteOperationId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateQuoteOperation, "Failed to update quote operation")
      )
    );
  }

  return json({ id: quoteOperationId });
}
