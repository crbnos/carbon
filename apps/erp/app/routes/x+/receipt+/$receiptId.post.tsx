import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { postReceipt } from "~/modules/inventory/inventory.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("receiptId not found");

  const formData = await request.formData();
  const acknowledged = formData.get("acknowledged") === "true";

  // Rule evaluation, the Pending flip, the post-receipt edge function and its
  // follow-ups live in the command, shared with the inventory_postReceipt tool.
  const result = await postReceipt(client, {
    receiptId,
    companyId,
    userId,
    acknowledged
  });

  if (result.error) {
    throw redirect(
      path.to.receipt(receiptId),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  if (result.data.status === "blocked") {
    return {
      error: null,
      data: null,
      violations: result.data.violations,
      ruleNames: result.data.ruleNames
    };
  }

  throw redirect(path.to.receipt(receiptId));
}
