import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAssemblyComponentMapping } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "production"
  });

  const { mappingId } = params;
  if (!mappingId) throw new Error("mappingId is not found");

  const deleteMapping = await deleteAssemblyComponentMapping(client, mappingId);
  if (deleteMapping.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(deleteMapping.error, "Failed to remove mapping")
      )
    );
  }

  return { success: true };
}
