import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  attributeCategoryValidator,
  insertAttributeCategory
} from "~/modules/people";
import { AttributeCategoryForm } from "~/modules/people/ui/Attributes";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "people"
  });

  const validation = await validator(attributeCategoryValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, emoji, isPublic } = validation.data;

  const createAttributeCategory = await insertAttributeCategory({
    name,
    emoji,
    public: isPublic,
    companyId,
    createdBy: userId
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
    emoji: "",
    isPublic: false
  };

  return (
    <AttributeCategoryForm onClose={onClose} initialValues={initialValues} />
  );
}
