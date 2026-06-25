import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getStockMovements } from "~/modules/inventory";
import StockMovementsTable from "~/modules/inventory/ui/StockMovements/StockMovementsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Stock Movements`,
  to: path.to.stockMovements
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const movements = await getStockMovements(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (movements.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(movements.error, "Error loading stock movements")
      )
    );
  }

  return {
    movements: movements.data ?? [],
    count: movements.count ?? 0
  };
}

export default function StockMovementsRoute() {
  const { movements, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <StockMovementsTable data={movements} count={count ?? 0} />
    </VStack>
  );
}
