import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  AccountSubcategoryForm,
  getAccountSubcategory,
} from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields } from "~/utils/form";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
  });

  const { categoryId, subcategoryId } = params;
  if (!categoryId) throw notFound("categoryId not found");
  if (!subcategoryId) throw notFound("subcategoryId not found");

  const subcategory = await getAccountSubcategory(client, subcategoryId);
  if (subcategory.error) {
    throw redirect(
      path.to.accountingCategoryList(categoryId),
      await flash(
        request,
        error(subcategory.error, "Failed to fetch G/L account subcategory")
      )
    );
  }

  return json({
    subcategory: subcategory.data,
  });
}

export default function EditAccountSubcategoryRoute() {
  const { subcategory } = useLoaderData<typeof loader>();
  const { categoryId } = useParams();
  if (!categoryId) throw notFound("categoryId not found");

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.accountingCategoryList(categoryId));

  const initialValues = {
    ...subcategory,
    ...getCustomFields(subcategory.customFields),
  };

  return (
    <AccountSubcategoryForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={onClose}
    />
  );
}
