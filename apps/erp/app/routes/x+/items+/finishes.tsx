import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getMaterialFinishes } from "~/modules/items";
import MaterialFinishesTable from "~/modules/items/ui/MaterialFinishes/MaterialFinishesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "finishes");

export const handle: Handle = {
  breadcrumb: msg`Finishes`,
  to: path.to.materialFinishes
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

  const materialFinishes = await getMaterialFinishes(client, companyId, {
    limit,
    offset,
    sorts,
    search,
    filters
  });

  if (materialFinishes.error) {
    logger.error(materialFinishes.error);
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
