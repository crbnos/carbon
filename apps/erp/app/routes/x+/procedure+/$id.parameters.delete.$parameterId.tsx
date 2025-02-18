import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { deleteProcedureParameter } from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "production",
  });

  const { parameterId } = params;

  if (!parameterId) throw new Error("parameterId is not found");

  const deleteParameter = await deleteProcedureParameter(
    client,
    parameterId,
    companyId
  );
  if (deleteParameter.error) {
    return json(
      {
        success: false,
      },
      await flash(
        request,
        error(deleteParameter.error, "Failed to delete parameter")
      )
    );
  }

  return json(
    {
      success: true,
    },
    await flash(request, success("Successfully deleted parameter"))
  );
}
