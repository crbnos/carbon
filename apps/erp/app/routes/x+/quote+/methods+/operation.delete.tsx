import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteQuoteOperationWithPrices } from "~/modules/sales/sales.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "sales"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;

  if (!id) {
    return data(
      { error: "Operation ID is required" },
      {
        status: 400
      }
    );
  }

  // The delete and the line reprice are one command — the same one
  // `sales_deleteQuoteOperation` runs over MCP.
  const deleted = await deleteQuoteOperationWithPrices(client, {
    quoteOperationId: id,
    companyId,
    userId
  });

  if (deleted.error && deleted.failedStep !== "recalculate") {
    return data(
      { success: false, error: deleted.error.message },
      {
        status: 400
      }
    );
  }

  return { success: true };
}
