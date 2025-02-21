import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  notFound,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { deleteAttributeRecord } from "~/services/operations.service";

export async function action({ params, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});
  const { id } = params;

  if (!id) {
    throw notFound("Attribute ID is required");
  }

  const serviceRole = await getCarbonServiceRole();

  const attributeDelete = await deleteAttributeRecord(serviceRole, {
    id,
    companyId,
    userId,
  });

  if (attributeDelete.error) {
    return json(
      { success: false },
      await flash(
        request,
        error(attributeDelete.error, "Failed to delete attribute")
      )
    );
  }

  return json(
    { success: true },
    await flash(request, success("Attribute record deleted successfully"))
  );
}
