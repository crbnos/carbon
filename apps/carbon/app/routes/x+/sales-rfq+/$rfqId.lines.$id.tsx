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

  const { rfqId, id } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }
  if (!id) {
    throw new Error("id not found");
  }

  const formData = await request.formData();
  const validation = await validator(salesRfqLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateSalesRfqLine = await upsertSalesRFQLine(client, {
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateSalesRfqLine.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateSalesRfqLine.error, "Failed to update RFQ line")
      )
    );
  }

  const salesRfqLineId = updateSalesRfqLine.data?.id;
  if (!salesRfqLineId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(updateSalesRfqLine, "Failed to update RFQ line")
      )
    );
  }

  return json({ id: salesRfqLineId });
}
