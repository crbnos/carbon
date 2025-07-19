import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getMaterialGrades } from "~/modules/items";
import MaterialGradesTable from "~/modules/items/ui/MaterialGrades/MaterialGradesTable";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Grades",
  to: path.to.materialGrades,
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

  const [materialGrades] = await Promise.all([
    getMaterialGrades(client, companyId, {
      limit,
      offset,
      sorts,
      search,
      filters,
    }),
  ]);

  if (materialGrades.error) {
    console.error(materialGrades.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material substances"))
    );
  }

  return json({
    materialGrades: materialGrades.data ?? [],
    count: materialGrades.count ?? 0,
  });
}

export default function MaterialGradesRoute() {
  const { materialGrades, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialGradesTable data={materialGrades} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
