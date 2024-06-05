import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { ServicesTable, getItemGroupsList, getServices } from "~/modules/parts";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Services",
  to: path.to.services,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const type = searchParams.get("type");
  const group = searchParams.get("group");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [services, itemGroups] = await Promise.all([
    getServices(client, companyId, {
      search,
      type,
      group,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
    getItemGroupsList(client, companyId),
  ]);

  if (services.error) {
    redirect(
      path.to.items,
      await flash(request, error(services.error, "Failed to fetch services"))
    );
  }

  return json({
    count: services.count ?? 0,
    services: services.data ?? [],
    itemGroups: itemGroups.data ?? [],
  });
}

export default function ServicesSearchRoute() {
  const { count, services, itemGroups } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ServicesTable data={services} count={count} itemGroups={itemGroups} />
      <Outlet />
    </VStack>
  );
}
