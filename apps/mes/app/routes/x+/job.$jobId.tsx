// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import {
  Heading,
  IconButton,
  SidebarTrigger,
  ToggleGroup,
  ToggleGroupItem,
  useLocalStorage,
  useViewport
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuArrowLeft, LuList, LuWorkflow } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { JobDag } from "~/components/JobDag";
import { JobOperationsList } from "~/components/JobDag/JobOperationsList";
import { MesAppBar } from "~/components/MesAppBar";
import {
  getJobOperationDependencies,
  getJobOperations
} from "~/services/operations.service";
import type { Handle } from "~/utils/handle";
import { recordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [
    { table: "job", column: "id", param: "jobId" },
    { table: "jobOperation", column: "jobId", param: "jobId" }
  ]
};

const logger = getLogger("mes", "job-dag");

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(data?.readableId, "Job");

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
    logger.warning("Job not found in company", {
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

type JobView = "list" | "chart";

// Per device: the operator's last choice for every job page.
const JOB_VIEW_KEY = "mes-job-operations-view";

export default function JobDagRoute() {
  const { readableId, operations, dependencies } =
    useLoaderData<typeof loader>();
  const { isPhone } = useViewport();
  const { t } = useLingui();
  const [view, setView] = useLocalStorage<JobView>(JOB_VIEW_KEY, "list");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar
        title={readableId}
        subtitle={<Trans>Jobs</Trans>}
        back={{ to: path.to.jobs }}
        actions={
          <IconButton
            aria-label={view === "list" ? t`Flow chart view` : t`List view`}
            variant="ghost"
            size="lg"
            icon={view === "list" ? <LuWorkflow /> : <LuList />}
            onClick={() => setView(view === "list" ? "chart" : "list")}
          />
        }
      />
      {!isPhone && (
        <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-card max-md:hidden">
          <div className="flex items-center gap-2 px-2">
            <SidebarTrigger />
            <Link
              to={path.to.jobs}
              aria-label={t`Back`}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <LuArrowLeft className="w-4 h-4" aria-hidden />
            </Link>
            <Heading as="h1" size="h4">
              {readableId}
            </Heading>
          </div>
          <ToggleGroup
            type="single"
            aria-label={t`View`}
            value={view}
            onValueChange={(value) => {
              if (value) setView(value as JobView);
            }}
            className="ml-auto px-2"
          >
            <ToggleGroupItem value="list" aria-label={t`List view`}>
              <LuList />
            </ToggleGroupItem>
            <ToggleGroupItem value="chart" aria-label={t`Flow chart view`}>
              <LuWorkflow />
            </ToggleGroupItem>
          </ToggleGroup>
        </header>
      )}

      {view === "chart" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <JobDag operations={operations} dependencies={dependencies} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
          <JobOperationsList
            operations={operations}
            dependencies={dependencies}
          />
        </div>
      )}
    </div>
  );
}
