import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getMaterialFinishes } from "~/modules/items/items.service.server";
import MaterialFinishesTable from "~/modules/items/ui/MaterialFinishes/MaterialFinishesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Finishes`,
  to: path.to.materialFinishes
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const materialFinishes = await getMaterialFinishes({
    limit,
    offset,
    sorts,
    search,
    filters
  });

  if (materialFinishes.error) {
    console.error(materialFinishes.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material substances"))
    );
  }

  return {
    materialFinishes: materialFinishes.data ?? [],
    count: materialFinishes.count ?? 0
  };
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
