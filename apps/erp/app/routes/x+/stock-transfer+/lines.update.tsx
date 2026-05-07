import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { getStockTransfer, isStockTransferLocked } from "~/modules/inventory";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids") as string[];
  const field = formData.get("field");
  const value = formData.get("value");

  // Look up the stock transfer from the first line to check locked status.
  if (ids.length > 0) {
    const line = await client
      .from("stockTransferLine")
      .select("stockTransferId")
      .eq("id", ids[0] as string)
      .single();

    if (line.data?.stockTransferId) {
      const { client: viewClient } = await requirePermissions(request, {
        view: "inventory"
      });
      const transfer = await getStockTransfer(
        viewClient,
        line.data.stockTransferId
      );
      await requireUnlocked({
        request,
        isLocked: isStockTransferLocked(transfer.data?.status),
        redirectTo: path.to.stockTransfer(line.data.stockTransferId),
        message: "Cannot modify a locked stock transfer. Reopen it first."
      });
    }
  }

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  if (field !== "fromStorageUnitId" && field !== "toStorageUnitId") {
    return { error: { message: `Invalid field: ${field}` }, data: null };
  }

  // Item Rule evaluation runs at commit time (when the transfer is posted),
  // not on per-line edits. Saves go straight through.
  const update = await client
    .from("stockTransferLine")
    .update({
      [field]: value ? value : null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .in("id", ids)
    .eq("companyId", companyId);

  return update;
}
