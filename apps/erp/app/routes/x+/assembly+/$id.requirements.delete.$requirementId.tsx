import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteAssemblyInstructionStepRequirement,
  getAssemblyInstructionStepRequirement
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { requirementId } = params;
  if (!requirementId) throw new Error("requirementId is not found");

  // Media rows own a storage object — remove it before the row
  const requirement = await getAssemblyInstructionStepRequirement(
    client,
    requirementId
  );
  if (requirement.data?.type === "Media" && requirement.data.filePath) {
    await client.storage.from("private").remove([requirement.data.filePath]);
  }

  const deleteRequirement = await deleteAssemblyInstructionStepRequirement(
    client,
    requirementId
  );
  if (deleteRequirement.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(deleteRequirement.error, "Failed to delete requirement")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Successfully deleted requirement"))
  );
}
