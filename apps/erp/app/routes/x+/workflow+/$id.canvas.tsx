import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Json } from "@carbon/database";
import { requirePlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  updateWorkflowCanvasState,
  workflowCanvasStateValidator
} from "~/modules/workflows";
import { path } from "~/utils/path";

// Canvas state is per workflow, not per version, so the live-version lock does
// not apply here — you may pan and zoom a published version.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
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

  const validation = await validator(workflowCanvasStateValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateWorkflowCanvasState(client, {
    id,
    companyId,
    canvasState: validation.data as unknown as Json
  });

  if (update.error) {
    return data({ ok: false, error: update.error.message }, { status: 500 });
  }

  return data({ ok: true });
}
