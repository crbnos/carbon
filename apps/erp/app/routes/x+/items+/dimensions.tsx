// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import MaterialDimensionsTable from "~/modules/items/ui/MaterialDimensions/MaterialDimensionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "dimensions");

export const handle: Handle = {
  breadcrumb: msg`Dimensions`,
  to: path.to.materialDimensions
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "parts",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const settings = await api.settings.getCompanySettings({});

  const materialDimensions = await api.items.getMaterialDimensions({
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
    materialDimensions: materialDimensions.data?.rows ?? [],
    count: materialDimensions.data?.count ?? 0
  };
}

export default function MaterialDimensionsRoute() {
  const { materialDimensions, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialDimensionsTable data={materialDimensions} count={count ?? 0} />
      <RecordOutlet />
    </VStack>
  );
}
