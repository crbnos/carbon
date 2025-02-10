import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getShipments } from "~/modules/inventory";
import ShipmentsTable from "~/modules/inventory/ui/Shipments/ShipmentsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Shipments",
  to: path.to.shipments,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [shipments] = await Promise.all([
    getShipments(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
  ]);

  if (shipments.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(null, "Error loading shipments"))
    );
  }

  return json({
    shipments: shipments.data ?? [],
    count: shipments.count ?? 0,
  });
}

export default function ShipmentsRoute() {
  const { shipments, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ShipmentsTable data={shipments} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
