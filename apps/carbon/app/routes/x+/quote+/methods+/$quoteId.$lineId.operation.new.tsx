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

  const { quoteId, lineId } = params;
  if (!quoteId) {
    throw new Error("quoteId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const formData = await request.formData();
  const validation = await validator(quoteOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertQuoteOperation = await upsertQuoteOperation(client, {
    ...data,
    quoteId,
    quoteLineId: lineId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertQuoteOperation.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertQuoteOperation.error, "Failed to insert quote operation")
      )
    );
  }

  const quoteOperationId = insertQuoteOperation.data?.id;
  if (!quoteOperationId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertQuoteOperation, "Failed to insert quote operation")
      )
    );
  }

  return json({ id: quoteOperationId });
}
