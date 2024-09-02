import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  accountSubcategoryValidator,
  upsertAccountSubcategory,
} from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting",
  });

  const { subcategoryId } = params;
  if (!subcategoryId) throw new Error("subcategoryId not found");

  const formData = await request.formData();
  const validation = await validator(accountSubcategoryValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const update = await upsertAccountSubcategory(client, {
    id: subcategoryId,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (update.error)
    redirect(
      `${path.to.accountingCategories}?${getParams(request)}`,
      await flash(
        request,
        error(update.error, "Failed to update G/L subcategory")
      )
    );

  throw redirect(
    `${path.to.accountingCategories}?${getParams(request)}`,
    await flash(request, success("Successfully updated G/L subcategory"))
  );
}
