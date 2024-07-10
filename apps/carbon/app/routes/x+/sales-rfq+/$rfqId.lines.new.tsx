import { validationError, validator } from "@carbon/remix-validated-form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { salesRfqLineValidator, upsertSalesRFQLine } from "~/modules/sales";
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

  const { rfqId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }

  const formData = await request.formData();
  const validation = await validator(salesRfqLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const insertLine = await upsertSalesRFQLine(client, {
    ...validation.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertLine.error) {
    return json(
      {
        id: null,
      },
      await flash(request, error(insertLine.error, "Failed to insert RFQ line"))
    );
  }

  const methodMaterialId = insertLine.data?.id;
  if (!methodMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(request, error(insertLine, "Failed to insert RFQ line"))
    );
  }

  return json({ id: methodMaterialId });
}
