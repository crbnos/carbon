import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getMaterialForms } from "~/modules/items";
import { MaterialFormsTable } from "~/modules/items/ui/MaterialShapes";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Shapes`,
  to: path.to.materialForms
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

  const materialForms = await getMaterialForms({
    limit,
    offset,
    sorts,
    search,
    filters
  });

  if (materialForms.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material forms"))
    );
  }

  return {
    materialForms: materialForms.data ?? [],
    count: materialForms.count ?? 0
  };
}

export default function MaterialFormsRoute() {
  const { materialForms, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialFormsTable data={materialForms} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
