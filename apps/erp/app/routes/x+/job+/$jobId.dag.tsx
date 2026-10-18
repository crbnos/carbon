// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import { JobDag } from "~/modules/production/ui/Jobs";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "production",
    role: "employee"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const job = await api.production.getJob({ id: jobId });
  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  const [operations, dependencies] = await Promise.all([
    api.production.getJobOperations({ jobId }),
    api.production.getJobOperationDependencies({ jobId })
  ]);

  if (operations.error) {
    throw redirect(
      path.to.jobs,
      await flash(
        request,
        error(operations.error, "Failed to fetch job operations")
      )
    );
  }

  return {
    operations: operations.data?.rows ?? [],
    dependencies: dependencies.data ?? []
  };
}

export default function JobDagRoute() {
  const { operations, dependencies } = useLoaderData<typeof loader>();
  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <VStack
      spacing={0}
      className="h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))]"
    >
      <JobDag operations={operations} dependencies={dependencies} />
    </VStack>
  );
}
