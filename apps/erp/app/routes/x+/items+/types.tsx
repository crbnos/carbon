import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getMaterialTypes } from "~/modules/items";
import MaterialTypesTable from "~/modules/items/ui/MaterialTypes/MaterialTypesTable";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Types",
  to: path.to.materialTypes,
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

  const [materialTypes] = await Promise.all([
    getMaterialTypes(client, companyId, {
      limit,
      offset,
      sorts,
      search,
      filters,
    }),
  ]);

  if (materialTypes.error) {
    console.error(materialTypes.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material types"))
    );
  }

  return json({
    materialTypes: materialTypes.data ?? [],
    count: materialTypes.count ?? 0,
  });
}

export default function MaterialTypesRoute() {
  const { materialTypes, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialTypesTable data={materialTypes} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}