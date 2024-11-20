import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { FixturesTable, getFixtures } from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

import { getTagsList } from "~/modules/shared";
export const handle: Handle = {
  breadcrumb: "Fixtures",
  to: path.to.fixtures,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [fixtures, tags] = await Promise.all([
    getFixtures(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
    getTagsList(client, companyId, "fixture"),
  ]);

  if (fixtures.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(fixtures.error, "Failed to fetch fixtures"))
    );
  }

  return json({
    count: fixtures.count ?? 0,
    fixtures: fixtures.data ?? [],
    tags: tags.data ?? [],
  });
}

export default function FixturesSearchRoute() {
  const { count, fixtures, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <FixturesTable data={fixtures} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
