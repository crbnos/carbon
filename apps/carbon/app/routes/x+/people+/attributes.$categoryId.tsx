import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  AttributeCategoryForm,
  attributeCategoryValidator,
  getAttributeCategory,
  updateAttributeCategory,
} from "~/modules/people";
import { path } from "~/utils/path";

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
