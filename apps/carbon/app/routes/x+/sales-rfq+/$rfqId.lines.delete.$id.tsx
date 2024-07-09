import { json, type ActionFunctionArgs } from "@remix-run/node";
import { deleteSalesRFQLine } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { rfqId, id } = params;
  if (!rfqId) {
    throw new Error("rfqId not found");
  }
  if (!id) {
    throw new Error("id not found");
  }

  const deleteLine = await deleteSalesRFQLine(client, id);
  if (deleteLine.error) {
    return json(
      {
        id: null,
      },
      await flash(request, error(deleteLine.error, "Failed to delete RFQ line"))
    );
  }

  return json({});
}
