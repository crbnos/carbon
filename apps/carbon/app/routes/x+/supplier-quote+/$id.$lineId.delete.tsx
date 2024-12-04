import { json, redirect } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteSupplierQuoteLine } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find supplierQuoteId");
  if (!lineId) throw new Error("Could not find supplierQuoteLineId");

  const deleteLine = await deleteSupplierQuoteLine(client, lineId);

  if (deleteLine.error) {
    return json(
      path.to.supplierQuoteLine(id, lineId),
      await flash(
        request,
        error(deleteLine.error, "Failed to delete quote line")
      )
    );
  }

  throw redirect(path.to.supplierQuote(id));
}
