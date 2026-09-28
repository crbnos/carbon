import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { Heading, SidebarTrigger } from "@carbon/react";
import { LuArrowLeft } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { JobDag } from "~/components/JobDag";
import {
  getJobOperationDependencies,
  getJobOperations
} from "~/services/operations.service";
import { path } from "~/utils/path";

const logger = getLogger("mes", "job-dag");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  // Service-role reads below are keyed on jobId alone, so the job must be
  // verified as this company's before any of them run.
  const job = await serviceRole
    .from("job")
    .select("jobId")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!job.data) {
    logger.warn("Job not found in company", {
      companyId,
      jobId,
      error: job.error
    });
    throw redirect(path.to.jobs);
  }

  const [operations, dependencies] = await Promise.all([
    getJobOperations(serviceRole, jobId),
    getJobOperationDependencies(serviceRole, jobId)
  ]);

  return {
    readableId: job.data.jobId ?? jobId,
    operations: operations.data ?? [],
    dependencies: dependencies.data ?? []
  };
}

export default function JobDagRoute() {
  const { readableId, operations, dependencies } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-card">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Link
            to={path.to.jobs}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <LuArrowLeft className="w-4 h-4" />
          </Link>
          <Heading size="h4">{readableId}</Heading>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <JobDag operations={operations} dependencies={dependencies} />
      </main>
    </div>
  );
}
