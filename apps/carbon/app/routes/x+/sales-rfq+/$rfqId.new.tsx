import { validationError, validator } from "@carbon/remix-validated-form";
import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { salesRfqLineValidator, upsertSalesRFQLine } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
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

  const { id, ...data } = validation.data;

  const insertLine = await upsertSalesRFQLine(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertLine.error) {
    throw redirect(
      path.to.salesRfq(rfqId),
      await flash(request, error(insertLine.error, "Failed to insert RFQ line"))
    );
  }

  const lineId = insertLine.data?.id;
  if (!lineId) {
    throw redirect(
      path.to.salesRfq(rfqId),
      await flash(request, error(insertLine, "Failed to insert RFQ line"))
    );
  }

  throw redirect(path.to.salesRfqLine(rfqId, lineId));
}
