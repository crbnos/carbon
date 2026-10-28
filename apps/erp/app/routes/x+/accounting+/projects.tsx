// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { ProjectsTable } from "~/modules/accounting/ui/Projects";
import type { Handle } from "~/utils/handle";
import { projectsList } from "~/utils/list-registry/accounting.server";
import { fetchListPage } from "~/utils/list-registry/index.server";
import { listErrorPage, listInfinite } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "projects");

export const handle: Handle = {
  breadcrumb: msg`Projects`,
  to: path.to.projects
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(
    request,
    projectsList.permission
  );

  const searchParams = new URL(request.url).searchParams;
  const projects = await fetchListPage(
    projectsList,
    client,
    companyId,
    searchParams
  );

  if (projects.error) {
    if (searchParams.get("after")) {
      logger.error("Failed to load a later page of projects", {
        companyId,
        error: projects.error
      });
      return listErrorPage("data");
    }
    return data(
      {
        data: [],
        count: 0,
        nextCursor: null,
        infinite: listInfinite(projectsList, "data", null)
      },
      await flash(request, error(projects.error, "Failed to fetch projects"))
    );
  }

  return {
    data: projects.rows,
    count: projects.count,
    exactCount: projects.exactCount,
    nextCursor: projects.nextCursor,
    infinite: listInfinite(projectsList, "data", projects.nextCursor)
  };
}

export default function ProjectsRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProjectsTable data={data ?? []} count={count ?? 0} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
