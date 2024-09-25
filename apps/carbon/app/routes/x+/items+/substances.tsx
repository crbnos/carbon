import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  MaterialSubstancesTable,
  getMaterialSubstances,
} from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Substances",
  to: path.to.materialSubstances,
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

  const [materialSubstances] = await Promise.all([
    getMaterialSubstances(client, companyId, {
      limit,
      offset,
      sorts,
      search,
      filters,
    }),
  ]);

  if (materialSubstances.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material substances"))
    );
  }

  return json({
    materialSubstances: materialSubstances.data ?? [],
    count: materialSubstances.count ?? 0,
  });
}

export default function MaterialSubstancesRoute() {
  const { materialSubstances, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialSubstancesTable data={materialSubstances} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
