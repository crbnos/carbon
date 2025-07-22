import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { deleteIssueWorkflow } from "~/modules/quality";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "quality",
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deleteIssueWorkflow(client, id);
  if (mutation.error) {
    return json(
      {
        success: false,
      },
      await flash(
        request,
        error(mutation.error, "Failed to delete issue workflow")
      )
    );
  }

  throw redirect(
    path.to.issueWorkflows,
    await flash(request, success("Successfully deleted issue workflow"))
  );
}
