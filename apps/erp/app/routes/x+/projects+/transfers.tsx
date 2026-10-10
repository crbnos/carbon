// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getProjectStockTransfers } from "~/modules/projects";
import ProjectStockTransfersTable from "~/modules/projects/ui/Transfers/ProjectStockTransfersTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "project-stock-transfers");

export const handle: Handle = {
  breadcrumb: msg`Transfers`,
  to: path.to.projectStockTransfers,
  module: "projects"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const transfers = await getProjectStockTransfers(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (transfers.error) {
    logger.error("Failed to load project stock transfers", {
      companyId,
      error: transfers.error
    });
    throw redirect(
      path.to.projects,
      await flash(
        request,
        error(transfers.error, "Failed to load project stock transfers")
      )
    );
  }

  return {
    transfers: transfers.data ?? [],
    count: transfers.count ?? 0
  };
}

export default function ProjectStockTransfersRoute() {
  const { transfers, count } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <ProjectStockTransfersTable data={transfers} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
