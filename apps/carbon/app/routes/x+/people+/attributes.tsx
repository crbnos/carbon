import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import {
  AttributeCategoriesTable,
  getAttributeCategories,
  getAttributeDataTypes,
} from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Attributes",
  to: path.to.attributes,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [categories, dataTypes] = await Promise.all([
    getAttributeCategories(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getAttributeDataTypes(client),
  ]);

  if (categories.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(categories.error, "Failed to fetch attribute categories")
      )
    );
  }

  return json({
    count: categories.count ?? 0,
    categories: categories.data ?? [],
    dataTypes: dataTypes.data ?? [],
  });
}

export default function UserAttributesRoute() {
  const { count, categories } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AttributeCategoriesTable data={categories} count={count} />
      <Outlet />
    </VStack>
  );
}
