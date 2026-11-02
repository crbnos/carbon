// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { type LoaderFunctionArgs, useLoaderData } from "react-router";
import { ProjectsTable } from "~/modules/projects/ui/Projects";
import { loadListPage } from "~/utils/list-registry/load.server";
import { projectsList } from "~/utils/list-registry/projects.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, projectsList, {
    dataKey: "projects",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch projects"
    }
  });
}

export default function ProjectsListRoute() {
  const { count, projects, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProjectsTable data={projects} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
