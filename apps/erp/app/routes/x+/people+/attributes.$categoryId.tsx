import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { attributeCategoryValidator } from "~/modules/people";
import {
  getAttributeCategory,
  updateAttributeCategory
} from "~/modules/people/people.service.server";
import { AttributeCategoryForm } from "~/modules/people/ui/Attributes";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people",
    role: "employee"
  });

  const { categoryId } = params;
  if (!categoryId) throw notFound("Invalid categoryId");

  const attributeCategory = await getAttributeCategory(categoryId);
  if (attributeCategory.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(attributeCategory.error, "Failed to fetch attribute category")
      )
    );
  }

  return { attributeCategory: attributeCategory.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "people"
  });

  const validation = await validator(attributeCategoryValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, name, emoji, isPublic } = validation.data;
  if (!id) throw new Error("ID is was not found");

  const updateCategory = await updateAttributeCategory({
    id,
    name,
    emoji,
    public: isPublic
  });
  if (updateCategory.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(updateCategory.error, "Failed to update attribute category")
      )
    );
  }

  throw redirect(
    path.to.attributes,
    await flash(request, success("Updated attribute category "))
  );
}

export default function EditAttributeCategoryRoute() {
  const { attributeCategory } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.attributes);

  const initialValues = {
    id: attributeCategory?.id,
    name: attributeCategory?.name ?? "",
    emoji: attributeCategory?.emoji ?? "",
    isPublic: attributeCategory?.public ?? false
  };

  return (
    <AttributeCategoryForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
    />
  );
}
