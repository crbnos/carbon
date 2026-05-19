import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getSalesRFQ,
  isSalesRfqLocked,
  salesRfqLineValidator,
  upsertSalesRFQLine
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { rfqId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }

  await requirePermissions(request, {
    view: "sales"
  });

  const rfq = await getSalesRFQ(rfqId);
  await requireUnlocked({
    request,
    isLocked: isSalesRfqLocked(rfq.data?.status),
    redirectTo: path.to.salesRfq(rfqId),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesRfqLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertLine = await upsertSalesRFQLine({
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
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
