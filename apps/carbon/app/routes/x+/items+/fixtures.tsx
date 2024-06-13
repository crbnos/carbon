import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { FixturesTable, getFixtures, getItemGroupsList } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

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

  const [fixtures, itemGroups] = await Promise.all([
    getFixtures(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
    getItemGroupsList(client, companyId),
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
    itemGroups: itemGroups.data ?? [],
  });
}

export default function FixturesSearchRoute() {
  const { count, fixtures, itemGroups } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <FixturesTable data={fixtures} count={count} itemGroups={itemGroups} />
      <Outlet />
    </VStack>
  );
}
