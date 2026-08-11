import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { workflowToggleValidator } from "~/modules/workflows";
import { setWorkflowActive } from "~/modules/workflows/workflows.server";
import { path } from "~/utils/path";

// The one route both the list switch and the header switch post to, so there is
// exactly one place that has to remember to re-sync the trigger rows.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "workflows"
  });
  await requirePlan({
    request,
    client,
    companyId,
    feature: "WORKFLOWS",
    redirectTo: path.to.workflows
  });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const formData = await request.formData();
  const validation = await validator(workflowToggleValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const toggled = await setWorkflowActive(client, {
    workflowId: id,
    companyId,
    userId,
    active: validation.data.active
  });

  if (!toggled.ok) {
    return data(
      { success: false },
      await flash(request, error(null, toggled.message ?? "Failed to update"))
    );
  }

  return data(
    { success: true },
    await flash(
      request,
      success(validation.data.active ? "Workflow is on" : "Workflow is off")
    )
  );
}
