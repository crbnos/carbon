import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, chargeId } = params;
  if (!id || !chargeId) throw new Error("Could not find id");

  const serviceRole = getCarbonServiceRole();

  // Consumption + the GL split (warranty expense vs COGS) live in the edge
  // function so the ledger write and the journal share one transaction.
  const issued = await serviceRole.functions.invoke("issue", {
    body: {
      type: "partsToRepairOrder",
      chargeId,
      companyId,
      userId
    }
  });

  if (issued.error) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(
        request,
        error(
          issued.error,
          await getEdgeFunctionErrorMessage(
            issued.error,
            "Failed to issue part"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.repairOrderDetails(id),
    await flash(request, success("Part issued to the repair"))
  );
}
