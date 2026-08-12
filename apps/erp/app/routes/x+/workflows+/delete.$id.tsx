import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteWorkflow } from "~/modules/workflows";
import { syncAfterWorkflowDelete } from "~/modules/workflows/workflows.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "workflows"
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

  const mutation = await deleteWorkflow(client, id, companyId);
  if (mutation.error) {
    return data(
      { success: false },
      await flash(request, error(mutation.error, "Failed to delete workflow"))
    );
  }

  // The cascade takes the trigger rows; only this drops the now-unused
  // eventSystemSubscription rows the company no longer has a workflow for.
  await syncAfterWorkflowDelete(companyId, id);

  throw redirect(
    path.to.workflows,
    await flash(request, success("Successfully deleted workflow"))
  );
}
