import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deletePurchasingRFQ } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const purchasingRfqDelete = await deletePurchasingRFQ(client, rfqId);

  if (purchasingRfqDelete.error) {
    return data(
      path.to.purchasingRfqs,
      await flash(
        request,
        error(purchasingRfqDelete.error, purchasingRfqDelete.error.message)
      )
    );
  }

  throw redirect(path.to.purchasingRfqs);
}
