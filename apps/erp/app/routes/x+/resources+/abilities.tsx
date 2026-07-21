import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { AbilitiesTable, getAbilities } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Abilities`,
  to: path.to.abilities
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const abilities = await getAbilities(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (abilities.error) {
    throw redirect(
      path.to.resources,
      await flash(request, error(abilities.error, "Failed to fetch abilities"))
    );
  }

  return {
    count: abilities.count ?? 0,
    abilities: abilities.data ?? []
  };
}

export default function AbilitiesRoute() {
  const { count, abilities } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AbilitiesTable data={abilities} count={count} />
      <Outlet />
    </VStack>
  );
}
