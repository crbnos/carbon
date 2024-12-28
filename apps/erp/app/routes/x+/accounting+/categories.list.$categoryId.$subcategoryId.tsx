import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getAccountSubcategory } from "~/modules/accounting";
import { AccountSubcategoryForm } from "~/modules/accounting/ui/AccountCategories";
import { getCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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
