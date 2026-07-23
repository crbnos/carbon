import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import invariant from "tiny-invariant";
import { changeInspectionDocument } from "~/modules/quality/quality.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const formData = await request.formData();
  const inspectionDocumentId =
    (formData.get("inspectionDocumentId") as string | null)?.trim() || null;

  const result = await changeInspectionDocument({
    inspectionId: id,
    inspectionDocumentId,
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.inspection(id),
      await flash(request, error(result.error, "Failed to change document"))
    );
  }

  throw redirect(
    path.to.inspection(id),
    await flash(request, success("Inspection plan updated"))
  );
}
