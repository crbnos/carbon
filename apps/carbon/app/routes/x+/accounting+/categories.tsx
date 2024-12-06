import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getAccountCategories } from "~/modules/accounting";
import { AccountCategoriesTable } from "~/modules/accounting/ui/AccountCategories";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Categories",
  to: path.to.accountingCategories,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [categories] = await Promise.all([
    getAccountCategories(client, companyId, {
      search,

      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (categories.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(categories.error, "Failed to fetch account categories")
      )
    );
  }

  return json({
    count: categories.count ?? 0,
    categories: categories.data ?? [],
  });
}

export default function GlAccountCategoriesRoute() {
  const { count, categories } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AccountCategoriesTable data={categories} count={count} />
      <Outlet />
    </VStack>
  );
}
