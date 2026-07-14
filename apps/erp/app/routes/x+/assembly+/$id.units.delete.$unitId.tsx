import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAssemblyUnit } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { unitId } = params;
  if (!unitId) throw new Error("unitId is not found");

  const remove = await deleteAssemblyUnit(client, unitId);
  if (remove.error) {
    return data(
      { success: false },
      await flash(request, error(remove.error, "Failed to delete unit"))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Successfully deleted unit"))
  );
}
