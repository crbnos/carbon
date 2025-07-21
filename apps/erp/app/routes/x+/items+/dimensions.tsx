import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getMaterialDimensions } from "~/modules/items";
import MaterialDimensionsTable from "~/modules/items/ui/MaterialDimensions/MaterialDimensionsTable";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Dimensions",
  to: path.to.materialDimensions,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [materialDimensions] = await Promise.all([
    getMaterialDimensions(client, companyId, {
      limit,
      offset,
      sorts,
      search,
      filters,
    }),
  ]);

  if (materialDimensions.error) {
    console.error(materialDimensions.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material dimensions"))
    );
  }

  return json({
    materialDimensions: materialDimensions.data ?? [],
    count: materialDimensions.count ?? 0,
  });
}

export default function MaterialDimensionsRoute() {
  const { materialDimensions, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialDimensionsTable data={materialDimensions} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
