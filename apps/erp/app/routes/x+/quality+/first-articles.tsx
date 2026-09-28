import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getFirstArticleInspections } from "~/modules/quality";
import FirstArticlesTable from "~/modules/quality/ui/FirstArticles/FirstArticlesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`First Articles`,
  to: path.to.firstArticles
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const firstArticles = await getFirstArticleInspections(client, companyId, {
    search,
    status,
    limit,
    offset,
    sorts,
    filters
  });

  if (firstArticles.error) {
    throw redirect(
      path.to.quality,
      await flash(
        request,
        error(firstArticles.error, "Failed to load first articles")
      )
    );
  }

  return {
    firstArticles: firstArticles.data ?? [],
    count: firstArticles.count ?? 0
  };
}

export default function FirstArticlesRoute() {
  const { firstArticles, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <FirstArticlesTable data={firstArticles} count={count} />
      <Outlet />
    </VStack>
  );
}
