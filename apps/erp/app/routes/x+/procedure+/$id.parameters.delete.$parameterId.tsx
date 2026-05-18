import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteProcedureParameter } from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "production"
  });

  const { parameterId } = params;

  if (!parameterId) throw new Error("parameterId is not found");

  const deleteParameter = await deleteProcedureParameter(parameterId);
  if (deleteParameter.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(deleteParameter.error, "Failed to delete parameter")
      )
    );
  }

  return data(
    {
      success: true
    },
    await flash(request, success("Successfully deleted parameter"))
  );
}
