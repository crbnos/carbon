import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getMaterialFinishes } from "~/modules/items";
import MaterialFinishesTable from "~/modules/items/ui/MaterialFinishes/MaterialFinishesTable";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Finishes",
  to: path.to.materialFinishes,
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

  const [materialFinishes] = await Promise.all([
    getMaterialFinishes(client, companyId, {
      limit,
      offset,
      sorts,
      search,
      filters,
    }),
  ]);

  if (materialFinishes.error) {
    console.error(materialFinishes.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material substances"))
    );
  }

  return json({
    materialFinishes: materialFinishes.data ?? [],
    count: materialFinishes.count ?? 0,
  });
}

export default function MaterialFinishesRoute() {
  const { materialFinishes, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialFinishesTable data={materialFinishes} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
