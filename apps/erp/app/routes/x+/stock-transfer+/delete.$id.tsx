import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  deleteStockTransfer,
  getStockTransfer,
  isStockTransferLocked
} from "~/modules/inventory";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "inventory"
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  await requirePermissions(request, {
    view: "inventory"
  });
  const transfer = await getStockTransfer(id);
  await requireUnlocked({
    request,
    isLocked: isStockTransferLocked(transfer.data?.status),
    redirectTo: path.to.stockTransfer(id),
    message: "Cannot modify a locked stock transfer. Reopen it first."
  });

  const mutation = await deleteStockTransfer(id);
  if (mutation.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(mutation.error, "Failed to delete stock transfer")
      )
    );
  }

  throw redirect(
    path.to.stockTransfers,
    await flash(request, success("Successfully deleted stock transfer"))
  );
}
