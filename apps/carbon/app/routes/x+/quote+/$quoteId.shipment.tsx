import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { quoteShipmentValidator, upsertQuoteShipment } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const formData = await request.formData();
  const validation = await validator(quoteShipmentValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateQuoteShipment = await upsertQuoteShipment(client, {
    ...validation.data,
    id: quoteId,
    updatedBy: userId,
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
