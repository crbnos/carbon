import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  AttributeCategoryForm,
  attributeCategoryValidator,
  insertAttributeCategory,
} from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "people",
  });

  const validation = await validator(attributeCategoryValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, isPublic } = validation.data;

  const createAttributeCategory = await insertAttributeCategory(client, {
    name,
    public: isPublic,
    companyId,
    createdBy: userId,
  });
  if (createAttributeCategory.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(
          createAttributeCategory.error,
          "Failed to create attribute category"
        )
      )
    );
  }

  throw redirect(path.to.attributes);
}

export default function NewAttributeCategoryRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.attributes);

  const initialValues = {
    name: "",
    isPublic: false,
  };

  return (
    <AttributeCategoryForm onClose={onClose} initialValues={initialValues} />
  );
}
