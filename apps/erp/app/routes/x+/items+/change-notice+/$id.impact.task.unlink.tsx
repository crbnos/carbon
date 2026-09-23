import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { changeNoticeImpactTaskRelationshipFormValidator } from "~/modules/items";
import { unlinkAuthorizedChangeNoticeImpactTask } from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeNoticeId = params.id;
  if (!changeNoticeId) throw new Error("Could not find id");

  const validation = await validator(
    changeNoticeImpactTaskRelationshipFormValidator
  ).validate(await request.formData());
  if (validation.error) return validationError(validation.error);

  const result = await unlinkAuthorizedChangeNoticeImpactTask({
    client,
    companyId,
    userId,
    changeNoticeId,
    task: validation.data
  });

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to unlink Impact task"))
    );
  }

  return { success: true, data: result.data };
}
