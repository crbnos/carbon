import { validationError, validator } from "@carbon/remix-validated-form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { quoteOperationValidator, upsertQuoteOperation } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
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
