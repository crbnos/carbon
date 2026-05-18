import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteQuoteLine, getQuote, isQuoteLocked } from "~/modules/sales";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "sales"
  });

  const { quoteId, lineId: quoteLineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!quoteLineId) throw new Error("Could not find quoteLineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });
  const quote = await getQuote(viewClient, quoteId);
  await requireUnlocked({
    request,
    isLocked: isQuoteLocked(quote.data?.status),
    redirectTo: path.to.quote(quoteId),
    message: "Cannot modify a locked quote. Reopen it first."
  });

  const deleteLine = await deleteQuoteLine(quoteLineId);

  if (deleteLine.error) {
    return data(
      path.to.quoteLine(quoteId, quoteLineId),
      await flash(
        request,
        error(deleteLine.error, "Failed to delete quote line")
      )
    );
  }

  throw redirect(path.to.quote(quoteId));
}
