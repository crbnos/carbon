import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { updateWorkflow, workflowValidator } from "~/modules/workflows";
import { path } from "~/utils/path";

// Name and description only. This route never accepts an ownerId — a workflow
// runs with its owner's permissions, so ownership is taken, never assigned.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "workflows"
  });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const formData = await request.formData();
  const validation = await validator(workflowValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateWorkflow(client, {
    id,
    companyId,
    name: validation.data.name,
    description: validation.data.description,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update workflow"))
    );
  }

  throw redirect(
    path.to.workflows,
    await flash(request, success("Updated workflow"))
  );
}
