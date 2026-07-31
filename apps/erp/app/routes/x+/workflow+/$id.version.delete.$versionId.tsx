import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteWorkflowVersion, getWorkflow } from "~/modules/workflows";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "workflows"
  });

  const { id, versionId } = params;
  if (!id) throw new Error("id is not found");
  if (!versionId) throw new Error("versionId is not found");

  const workflow = await getWorkflow(client, id, companyId);

  // Refuse the live version: `ON DELETE SET NULL` on activeVersionId would
  // silently deactivate the workflow instead of failing.
  if (workflow.data?.activeVersionId === versionId) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          null,
          "This version is live. Publish another version before deleting it."
        )
      )
    );
  }

  const mutation = await deleteWorkflowVersion(client, versionId, companyId);
  if (mutation.error) {
    return data(
      { success: false },
      await flash(request, error(mutation.error, "Failed to delete version"))
    );
  }

  throw redirect(
    path.to.workflow(id),
    await flash(request, success("Successfully deleted version"))
  );
}
