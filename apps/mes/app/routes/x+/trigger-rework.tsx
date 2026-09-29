import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { recalculateAs } from "@carbon/operations/recalculate";
import { triggerReworkAs } from "@carbon/operations/trigger-rework";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { triggerReworkValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(triggerReworkValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = getCarbonServiceRole();

  const { trackedEntityIds: trackedEntityIdsJson, ...reworkData } =
    validation.data;
  const trackedEntityIds = trackedEntityIdsJson
    ? JSON.parse(trackedEntityIdsJson)
    : undefined;

  const result = await triggerReworkAs(serviceRole, getDatabaseClient(), {
    ...reworkData,
    trackedEntityIds,
    companyId,
    userId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to trigger rework"))
    );
  }

  // Trigger quantity recalculation
  await recalculateAs(serviceRole, getDatabaseClient(), {
    type: "jobRequirements",
    id: validation.data.jobId,
    companyId,
    userId
  });

  return data(
    result.data,
    await flash(request, success("Rework triggered successfully"))
  );
}
