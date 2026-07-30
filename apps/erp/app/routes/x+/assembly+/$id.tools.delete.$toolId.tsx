import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAssemblyInstructionStepTool } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { toolId } = params;
  if (!toolId) throw new Error("toolId is not found");

  const deleteTool = await deleteAssemblyInstructionStepTool(client, toolId);
  if (deleteTool.error) {
    return data(
      { success: false },
      await flash(request, error(deleteTool.error, "Failed to delete tool"))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Successfully deleted tool"))
  );
}
