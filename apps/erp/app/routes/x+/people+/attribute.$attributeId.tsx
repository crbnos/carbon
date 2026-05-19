import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { attributeValidator, updateAttribute } from "~/modules/people";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "people"
  });

  const validation = await validator(attributeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateAttribute({
    ...validation.data
  });
  if (update.error)
    redirect(
      path.to.attributes,
      await flash(request, error(update.error, "Failed to update attribute"))
    );

  throw redirect(
    path.to.attributeCategoryList(validation.data.userAttributeCategoryId),
    await flash(request, success("Successfully updated attribtue"))
  );
}
