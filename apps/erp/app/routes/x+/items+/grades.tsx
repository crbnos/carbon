import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getMaterialGrades } from "~/modules/items";
import MaterialGradesTable from "~/modules/items/ui/MaterialGrades/MaterialGradesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "grades");

export const handle: Handle = {
  breadcrumb: msg`Grades`,
  to: path.to.materialGrades
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const materialGrades = await getMaterialGrades(client, companyId, {
    limit,
    offset,
    sorts,
    search,
    filters
  });

  if (materialGrades.error) {
    logger.error(materialGrades.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material substances"))
    );
  }

  return {
    materialGrades: materialGrades.data ?? [],
    count: materialGrades.count ?? 0
  };
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
