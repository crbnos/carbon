import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getAttributeCategories,
  getAttributeDataTypes
} from "~/modules/people/people.service.server";
import { AttributeCategoriesTable } from "~/modules/people/ui/Attributes";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Attributes`,
  to: path.to.attributes
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [categories, dataTypes] = await Promise.all([
    getAttributeCategories({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getAttributeDataTypes()
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

  return {
    count: categories.count ?? 0,
    categories: categories.data ?? [],
    dataTypes: dataTypes.data ?? []
  };
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
