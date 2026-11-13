// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import LaborCategoriesTable from "~/modules/projects/ui/LaborCategories/LaborCategoriesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "labor-categories");

export const handle: Handle = {
  breadcrumb: msg`Labor Categories`,
  to: path.to.laborCategories
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api, companyId } = await authorize(request, {
    "projects.laborCategories": "View"
  });

  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const categories = await api.projects.getLaborCategories({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (categories.error) {
    logger.error("Failed to load labor categories", {
      companyId,
      error: categories.error
    });
    throw redirect(
      path.to.projects,
      await flash(
        request,
        error(categories.error, "Failed to load labor categories")
      )
    );
  }

  return {
    categories: categories.data?.rows ?? [],
    count: categories.data?.count ?? 0
  };
}

export default function LaborCategoriesRoute() {
  const { categories, count } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <LaborCategoriesTable data={categories} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
