import { Outlet, useLoaderData, useNavigate } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useUrlParams } from "~/hooks";
import {
  AccountCategoryDetail,
  getAccountCategory,
  getAccountSubcategoriesByCategory,
} from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
  });

  const { categoryId } = params;
  if (!categoryId) throw notFound("Invalid categoryId");

  const [accountCategory, accountSubcategories] = await Promise.all([
    getAccountCategory(client, categoryId),
    getAccountSubcategoriesByCategory(client, categoryId),
  ]);
  if (accountCategory.error) {
    throw redirect(
      path.to.accountingCategories,
      await flash(
        request,
        error(accountCategory.error, "Failed to fetch account category")
      )
    );
  }

  if (accountSubcategories.error) {
    throw redirect(
      path.to.accountingCategories,
      await flash(
        request,
        error(
          accountSubcategories.error,
          "Failed to fetch account subcategories"
        )
      )
    );
  }

  return json({
    accountCategory: accountCategory.data,
    accountSubcategories: accountSubcategories.data ?? [],
  });
}

export default function AccountCategoryListRoute() {
  const { accountCategory, accountSubcategories } =
    useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const onClose = () =>
    navigate(`${path.to.accountingCategories}?${params.toString()}`);

  return (
    <>
      <AccountCategoryDetail
        // @ts-expect-error
        accountCategory={accountCategory}
        accountSubcategories={accountSubcategories}
        onClose={onClose}
      />
      <Outlet />
    </>
  );
}
