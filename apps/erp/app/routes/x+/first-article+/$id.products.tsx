import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { firstArticleInspectionProductValidator } from "~/modules/quality";
import { upsertFirstArticleInspectionProduct } from "~/modules/quality/firstArticle.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(
    firstArticleInspectionProductValidator
  ).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  // The FAI comes from the URL, never from the form.
  const result = await upsertFirstArticleInspectionProduct(
    getDatabaseClient(),
    {
      ...validation.data,
      firstArticleInspectionId: id,
      companyId,
      userId
    }
  );
  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, result.error.message))
    );
  }

  throw redirect(
    path.to.firstArticle(id),
    await flash(request, success("Row saved"))
  );
}
