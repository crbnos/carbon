import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { deleteProcedureStep } from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "production",
  });

  const { attributeId } = params;

  if (!attributeId) throw new Error("attributeId is not found");

  const deleteAttribute = await deleteProcedureStep(
    client,
    attributeId,
    companyId
  );
  if (deleteAttribute.error) {
    return json(
      {
        success: false,
      },
      await flash(
        request,
        error(deleteAttribute.error, "Failed to delete attribute")
      )
    );
  }

  return json(
    {
      success: true,
    },
    await flash(request, success("Successfully deleted attribute"))
  );
}
