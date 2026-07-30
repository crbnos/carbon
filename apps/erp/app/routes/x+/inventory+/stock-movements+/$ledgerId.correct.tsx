import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  correctStockMovement,
  stockMovementCorrectionValidator
} from "~/modules/inventory";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { ledgerId } = params;
  if (!ledgerId) throw new Error("Could not find ledgerId");

  const formData = await request.formData();
  const validation = await validator(stockMovementCorrectionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const correction = await correctStockMovement(client, {
    ...validation.data,
    itemLedgerId: ledgerId,
    companyId,
    createdBy: userId
  });

  if (correction.error) {
    // Returned as fetcher data so the modal can toast the reason and stay
    // open — a redirect+flash would be lost on a fetcher submission.
    return { error: { message: correction.error }, data: null };
  }

  // The stock-movements table revalidates via realtime on itemLedger; the
  // modal closes itself on success.
  return { error: null, data: correction.data };
}
