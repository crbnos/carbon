import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteSalesRFQ } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "sales"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const salesRfqDelete = await deleteSalesRFQ(rfqId);

  if (salesRfqDelete.error) {
    return data(
      path.to.salesRfqs,
      await flash(
        request,
        error(salesRfqDelete.error, salesRfqDelete.error.message)
      )
    );
  }

  throw redirect(path.to.salesRfqs);
}
