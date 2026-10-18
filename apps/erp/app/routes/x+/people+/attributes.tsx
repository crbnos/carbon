// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AttributeCategoriesTable } from "~/modules/people/ui/Attributes";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Attributes`,
  to: path.to.attributes
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "people",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [categories, dataTypes] = await Promise.all([
    api.people.getAttributeCategories({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.people.getAttributeDataTypes({})
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
    count: categories.data?.count ?? 0,
    categories: categories.data?.rows ?? [],
    dataTypes: dataTypes.data ?? []
  };
}

export default function UserAttributesRoute() {
  const { count, categories } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AttributeCategoriesTable data={categories} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
