import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { attributeValidator, updateAttribute } from "~/modules/people";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "people",
  });

  const validation = await validator(attributeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateAttribute(client, {
    ...validation.data,
    updatedBy: userId,
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
