import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getOnshapeEngineeringData } from "~/modules/items";
import EngineeringDataTable from "~/modules/items/ui/EngineeringData/EngineeringDataTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "engineering-data");

export const handle: Handle = {
  breadcrumb: msg`Engineering Data`,
  to: path.to.engineeringData
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const engineeringData = await getOnshapeEngineeringData(client, companyId, {
    limit,
    offset,
    sorts,
    search,
    filters
  });

  if (engineeringData.error) {
    logger.error(engineeringData.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading engineering data"))
    );
  }

  return {
    engineeringData: engineeringData.data ?? [],
    count: engineeringData.count ?? 0
  };
}

export default function EngineeringDataRoute() {
  const { engineeringData, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <EngineeringDataTable data={engineeringData} count={count} />
      <Outlet />
    </VStack>
  );
}
