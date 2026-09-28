import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { voidReceipt } from "~/modules/inventory/inventory.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("receiptId not found");

  let result: Awaited<ReturnType<typeof voidReceipt>>;
  try {
    result = await voidReceipt(client, { receiptId, companyId, userId });
  } catch (err) {
    throw redirect(
      path.to.receiptDetails(receiptId),
      await flash(request, error(err, "Failed to void receipt"))
    );
  }

  if (result.error) {
    throw redirect(
      path.to.receiptDetails(receiptId),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  return redirect(
    path.to.receiptDetails(receiptId),
    await flash(request, success("Receipt voided"))
  );
}
