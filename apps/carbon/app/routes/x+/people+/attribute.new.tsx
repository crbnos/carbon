import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { attributeValidator, insertAttribute } from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "people",
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
    canSelfManage,
  } = validation.data;

  const createAttribute = await insertAttribute(client, {
    name,
    attributeDataTypeId: Number(attributeDataTypeId),
    userAttributeCategoryId,
    listOptions,
    canSelfManage,
    createdBy: userId,
  });
  if (createAttribute.error) {
    return json(
      {},
      await flash(
        request,
        error(createAttribute.error, "Failed to create attribute")
      )
    );
  }

  throw redirect(path.to.attributeCategoryList(userAttributeCategoryId));
}
