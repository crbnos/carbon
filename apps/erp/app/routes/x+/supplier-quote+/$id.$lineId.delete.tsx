import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { isSupplierQuoteLocked } from "~/modules/purchasing";
import {
  deleteSupplierQuoteLine,
  getSupplierQuote
} from "~/modules/purchasing/purchasing.service.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find supplierQuoteId");
  if (!lineId) throw new Error("Could not find supplierQuoteLineId");

  await requirePermissions(request, {
    view: "purchasing"
  });
  const quote = await getSupplierQuote(id);
  await requireUnlocked({
    request,
    isLocked: isSupplierQuoteLocked(quote.data?.status),
    redirectTo: path.to.supplierQuote(id),
    message: "Cannot modify a locked supplier quote. Reopen it first."
  });

  const deleteLine = await deleteSupplierQuoteLine(lineId);

  if (deleteLine.error) {
    return data(
      path.to.supplierQuoteLine(id, lineId),
      await flash(
        request,
        error(deleteLine.error, "Failed to delete quote line")
      )
    );
  }

  throw redirect(path.to.supplierQuote(id));
}
