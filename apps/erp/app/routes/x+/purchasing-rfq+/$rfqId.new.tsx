import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, redirect } from "react-router";
import {
  getPurchasingRFQ,
  isRfqLocked,
  purchasingRfqLineValidator,
  upsertPurchasingRFQLine
} from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { rfqId } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }

  const rfq = await getPurchasingRFQ(viewClient, rfqId);
  await requireUnlocked({
    request,
    isLocked: isRfqLocked(rfq.data?.status),
    redirectTo: path.to.purchasingRfq(rfqId),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(purchasingRfqLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertLine = await upsertPurchasingRFQLine({
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertLine.error) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(insertLine.error, "Failed to insert RFQ line"))
    );
  }

  const lineId = insertLine.data?.id;
  if (!lineId) {
    throw redirect(
      path.to.purchasingRfqDetails(rfqId),
      await flash(request, error(insertLine, "Failed to insert RFQ line"))
    );
  }

  throw redirect(path.to.purchasingRfqLine(rfqId, lineId));
}
