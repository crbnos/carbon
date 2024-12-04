import { json, redirect } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteQuoteLine } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { quoteId, lineId: quoteLineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!quoteLineId) throw new Error("Could not find quoteLineId");

  const deleteLine = await deleteQuoteLine(client, quoteLineId);

  if (deleteLine.error) {
    return json(
      path.to.quoteLine(quoteId, quoteLineId),
      await flash(
        request,
        error(deleteLine.error, "Failed to update quote line")
      )
    );
  }

  throw redirect(path.to.quote(quoteId));
}
