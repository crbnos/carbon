import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getServices } from "~/modules/items";
import { ServicesTable } from "~/modules/items/ui/Services";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Services`,
  to: path.to.services
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");
  const group = searchParams.get("group");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [services, tags] = await Promise.all([
    getServices(client, companyId, {
      search,
      supplierId,
      group,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList(client, companyId, "service")
  ]);

  if (services.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(services.error, "Failed to fetch services"))
    );
  }

  return {
    count: services.count ?? 0,
    services: services.data ?? [],
    tags: tags.data ?? []
  };
}

export default function ServicesSearchRoute() {
  const { count, services, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ServicesTable data={services} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
