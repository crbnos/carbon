import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getMaterialDimensions } from "~/modules/items";
import MaterialDimensionsTable from "~/modules/items/ui/MaterialDimensions/MaterialDimensionsTable";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "dimensions");

export const handle: Handle = {
  breadcrumb: msg`Dimensions`,
  to: path.to.materialDimensions
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

  const settings = await getCompanySettings(client, companyId);

  const materialDimensions = await getMaterialDimensions(client, companyId, {
    limit,
    offset,
    sorts,
    search,
    filters,
    isMetric: settings?.data?.useMetric ?? false
  });

  if (materialDimensions.error) {
    logger.error(materialDimensions.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material dimensions"))
    );
  }

  return {
    materialDimensions: materialDimensions.data ?? [],
    count: materialDimensions.count ?? 0
  };
}

export default function MaterialDimensionsRoute() {
  const { materialDimensions, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialDimensionsTable data={materialDimensions} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
