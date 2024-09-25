import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  MaterialsTable,
  getItemPostingGroupsList,
  getMaterials,
} from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Materials",
  to: path.to.materials,
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

  const [materials, itemPostingGroups] = await Promise.all([
    getMaterials(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
    getItemPostingGroupsList(client, companyId),
  ]);

  if (materials.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(materials.error, "Failed to fetch materials"))
    );
  }

  return json({
    count: materials.count ?? 0,
    materials: materials.data ?? [],
    itemPostingGroups: itemPostingGroups.data ?? [],
  });
}

export default function MaterialsSearchRoute() {
  const { count, materials, itemPostingGroups } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialsTable
        data={materials}
        count={count}
        itemPostingGroups={itemPostingGroups}
      />
      <Outlet />
    </VStack>
  );
}
