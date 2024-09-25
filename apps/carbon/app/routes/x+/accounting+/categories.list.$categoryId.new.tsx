import { useNavigate, useParams } from "@remix-run/react";
import {
  AccountSubcategoryForm,
  accountSubcategoryValidator,
  upsertAccountSubcategory,
} from "~/modules/accounting";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "accounting",
  });

  const formData = await request.formData();

  const validation = await validator(accountSubcategoryValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createSubcategory = await upsertAccountSubcategory(client, {
    ...data,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (createSubcategory.error) {
    return json(
      {},
      await flash(
        request,
        error(
          createSubcategory.error,
          "Failed to create G/L account subcategory"
        )
      )
    );
  }

  throw redirect(`${path.to.accountingCategories}?${getParams(request)}`);
}

export default function NewAccountSubcategoryRoute() {
  const { categoryId } = useParams();
  if (!categoryId) throw new Error("categoryId is not found");

  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const initialValues = {
    name: "",
    accountCategoryId: categoryId,
  };

  return (
    <AccountSubcategoryForm initialValues={initialValues} onClose={onClose} />
  );
}
