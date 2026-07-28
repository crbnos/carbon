import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { completeAllStepsForUnit } from "~/services/operations.service";

const log = getLogger("mes");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  // Manager override — gated on the Production DELETE permission (operators lack it).
  const { companyId, userId } = await requirePermissions(request, {
    delete: "production"
  });

  const formData = await request.formData();
  const operationId = formData.get("operationId")?.toString();
  const index = Number.parseInt(formData.get("index")?.toString() ?? "", 10);

  if (!operationId || Number.isNaN(index)) {
    return data(
      { success: false },
      await flash(request, error(null, "Missing operation or unit"))
    );
  }

  const serviceRole = await getCarbonServiceRole();
  const result = await completeAllStepsForUnit(serviceRole, {
    operationId,
    index,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to complete all steps"))
    );
  }

  if (result.data?.backflushError) {
    log.error("Backflush on complete-all override failed", {
      error: result.data.backflushError,
      operationId,
      index
    });
  }

  return data(
    { success: true },
    await flash(
      request,
      success(`Completed ${result.data?.count ?? 0} remaining step(s)`)
    )
  );
}
