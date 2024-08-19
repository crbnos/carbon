import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  AttributeCategoryForm,
  attributeCategoryValidator,
  getAttributeCategory,
  updateAttributeCategory,
} from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const { categoryId } = params;
  if (!categoryId) throw notFound("Invalid categoryId");

  const attributeCategory = await getAttributeCategory(client, categoryId);
  if (attributeCategory.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(attributeCategory.error, "Failed to fetch attribute category")
      )
    );
  }

  return json({ attributeCategory: attributeCategory.data });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "people",
  });

  const validation = await validator(attributeCategoryValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, name, isPublic } = validation.data;
  if (!id) throw new Error("ID is was not found");

  const updateCategory = await updateAttributeCategory(client, {
    id,
    name,
    public: isPublic,
    updatedBy: userId,
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
    isPublic: attributeCategory?.public ?? false,
  };

  return (
    <AttributeCategoryForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
    />
  );
}
