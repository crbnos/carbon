import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { isQuoteLocked, quoteShipmentValidator } from "~/modules/sales";
import {
  getQuote,
  upsertQuoteShipment
} from "~/modules/sales/sales.service.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  await requirePermissions(request, {
    view: "sales"
  });
  const quote = await getQuote(quoteId);
  await requireUnlocked({
    request,
    isLocked: isQuoteLocked(quote.data?.status),
    redirectTo: path.to.quote(quoteId),
    message: "Cannot modify a locked quote. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(quoteShipmentValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateQuoteShipment = await upsertQuoteShipment({
    ...validation.data,
    id: quoteId,
    updatedBy: userId
  });
  if (updateQuoteShipment.error) {
    throw redirect(
      path.to.quoteDetails(quoteId),
      await flash(
        request,
        error(updateQuoteShipment.error, "Failed to update quote shipment")
      )
    );
  }

  throw redirect(
    path.to.quoteDetails(quoteId),
    await flash(request, success("Updated quote shipment"))
  );
}
