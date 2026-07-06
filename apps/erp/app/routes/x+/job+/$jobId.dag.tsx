import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { usePanels } from "~/components/Layout";
import {
  getJob,
  getJobOperationDependencies,
  getJobOperations
} from "~/modules/production";
import { JobDag } from "~/modules/production/ui/Jobs";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const job = await getJob(client, jobId);
  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  const [operations, dependencies] = await Promise.all([
    getJobOperations(client, jobId),
    getJobOperationDependencies(client, jobId)
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
    operations: operations.data ?? [],
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
    <VStack spacing={0} className="h-[calc(100dvh-99px)]">
      <JobDag operations={operations} dependencies={dependencies} />
    </VStack>
  );
}
