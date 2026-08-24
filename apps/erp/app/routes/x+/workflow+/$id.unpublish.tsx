import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { unpublishWorkflow } from "~/modules/workflows/workflows.server";
import { path } from "~/utils/path";

// The one route both the list row menu and the builder button post to, so there is
// exactly one place that has to remember to re-sync the trigger rows. It carries no
// body: clearing the published version is the whole operation.
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

  const unpublished = await unpublishWorkflow(client, {
    workflowId: id,
    companyId,
    userId
  });

  if (!unpublished.ok) {
    return data(
      { success: false },
      await flash(
        request,
        error(null, unpublished.message ?? "Failed to unpublish")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Workflow unpublished"))
  );
}
