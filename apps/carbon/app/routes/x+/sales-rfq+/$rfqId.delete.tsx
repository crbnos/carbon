import { json, redirect } from "@remix-run/react";

import type { ActionFunctionArgs } from "@remix-run/node";
import { deleteSalesRFQ } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const quoteDelete = await deleteSalesRFQ(client, rfqId);

  if (quoteDelete.error) {
    return json(
      path.to.quotes,
      await flash(
        request,
        error(quoteDelete.error, "Failed to delete quote line")
      )
    );
  }

  throw redirect(path.to.quotes);
}
