import { json, redirect } from "@remix-run/react";

import type { ActionFunctionArgs } from "@vercel/remix";
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

  const salesRfqDelete = await deleteSalesRFQ(client, rfqId);

  if (salesRfqDelete.error) {
    return json(
      path.to.salesRfqs,
      await flash(request, error(salesRfqDelete.error, "Failed to delete RFQ"))
    );
  }

  throw redirect(path.to.salesRfqs);
}
