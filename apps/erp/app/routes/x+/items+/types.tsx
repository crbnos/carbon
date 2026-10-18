// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import MaterialTypesTable from "~/modules/items/ui/MaterialTypes/MaterialTypesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "types");

export const handle: Handle = {
  breadcrumb: msg`Types`,
  to: path.to.materialTypes
};

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });
  const api = carbonFor(auth);

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const materialTypes = await api.items.getMaterialTypes({
    limit,
    offset,
    sorts,
    search,
    filters
  });

  if (materialTypes.error) {
    logger.error(materialTypes.error);
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading material types"))
    );
  }

  return {
    materialTypes: materialTypes.data?.rows ?? [],
    count: materialTypes.data?.count ?? 0
  };
}

export default function MaterialTypesRoute() {
  const { materialTypes, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaterialTypesTable data={materialTypes} count={count ?? 0} />
      <RecordOutlet />
    </VStack>
  );
}
