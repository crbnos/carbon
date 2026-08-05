import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { recalculateQuoteLinePrices } from "~/modules/sales";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    delete: "sales"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string | null;
  const ids = [
    ...formData.getAll("ids").map(String),
    ...(id ? [id] : [])
  ].filter(Boolean);

  if (ids.length === 0) {
    return data(
      { error: "Operation ID is required" },
      {
        status: 400
      }
    );
  }

  // Fetch the operations' quoteId/quoteLineId before deleting
  const ops = await client
    .from("quoteOperation")
    .select("quoteId, quoteLineId")
    .in("id", ids);

  const { error } = await client.from("quoteOperation").delete().in("id", ids);

  if (error) {
    return data(
      { success: false, error: error.message },
      {
        status: 400
      }
    );
  }

  if (ops.data && ops.data.length > 0) {
    const serviceRole = getCarbonServiceRole();
    // All operations in a bulk delete belong to the same quote line
    await recalculateQuoteLinePrices(
      serviceRole,
      ops.data[0].quoteId,
      ops.data[0].quoteLineId,
      userId
    );
  }

  return { success: true };
}
