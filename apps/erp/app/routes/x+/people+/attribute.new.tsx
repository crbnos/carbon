import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { attributeValidator } from "~/modules/people";
import { insertAttribute } from "~/modules/people/people.service.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    create: "people"
  });

  const validation = await validator(attributeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    name,
    attributeDataTypeId,
    userAttributeCategoryId,
    listOptions,
    canSelfManage
  } = validation.data;

  const createAttribute = await insertAttribute({
    name,
    attributeDataTypeId: Number(attributeDataTypeId),
    userAttributeCategoryId,
    listOptions,
    canSelfManage
  });
  if (createAttribute.error) {
    return data(
      {},
      await flash(
        request,
        error(createAttribute.error, "Failed to create attribute")
      )
    );
  }

  throw redirect(path.to.attributeCategoryList(userAttributeCategoryId));
}
