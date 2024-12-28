import { json, redirect } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteSalesRFQ } from "~/modules/sales";
import { path } from "~/utils/path";

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
      await flash(
        request,
        error(salesRfqDelete.error, salesRfqDelete.error.message)
      )
    );
  }

  throw redirect(path.to.salesRfqs);
}
