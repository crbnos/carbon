// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import {
  Button,
  Input,
  MultiSelect,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useLocalStorage,
  useViewport,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuSearch } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { DateTime } from "~/components";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { userContext } from "~/context";
import { useUser } from "~/hooks";
import {
  getOpenJobs,
  getOpenWorkCenterIdsByJob,
  getTrackedEntitiesByJobMakeMethodIds,
  getWorkCenterOptionsByLocation
} from "~/services/operations.service";
import type { Handle } from "~/utils/handle";
import { pageMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["job", "jobOperation"]
};

const log = getLogger("mes");

export const meta: MetaFunction = () => pageMeta("Open Jobs");

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();
  const locationId = context.get(userContext)?.locationId;

  const [jobs, workCenters] = await Promise.all([
    getOpenJobs(serviceRole, { companyId, locationId }),
    getWorkCenterOptionsByLocation(serviceRole, { companyId, locationId })
  ]);

  if (jobs.error) {
    log.error("getOpenJobs error", { error: jobs.error });
  }
  if (workCenters.error) {
    log.error("getWorkCenterOptionsByLocation error", {
      error: workCenters.error
    });
  }

  const jobIds: string[] = [];
  const jobMakeMethodIds: string[] = [];
  for (const job of jobs.data ?? []) {
    if (job.id) jobIds.push(job.id);
    if (job.jobMakeMethodId) jobMakeMethodIds.push(job.jobMakeMethodId);
  }

  const [trackedEntities, workCenterIdsByJob] = await Promise.all([
    getTrackedEntitiesByJobMakeMethodIds(
      serviceRole,
      jobMakeMethodIds,
      companyId
    ),
    getOpenWorkCenterIdsByJob(serviceRole, { companyId, jobIds })
  ]);

  return {
    jobs: (jobs.data ?? []).map((job) => ({
      ...job,
      workCenterIds: (job.id && workCenterIdsByJob[job.id]) || []
    })),
    workCenters: workCenters.data ?? [],
    trackedEntities
  };
}

const WORK_CENTER_FILTER_KEY = "mes-jobs-work-center-filter";

type Job = {
  id: string;
  jobId: string;
  status: string;
  itemReadableIdWithRevision: string | null;
  name: string | null;
  quantity: number | null;
  quantityComplete: number | null;
  dueDate: string | null;
  deadlineType: string | null;
  assignee: string | null;
  jobMakeMethodId: string | null;
  workCenterIds: string[];
};

const STATUS_COLORS: Record<
  string,
  "gray" | "yellow" | "blue" | "orange" | "green" | "red"
> = {
  Draft: "gray",
  Planned: "yellow",
  Ready: "blue",
  "In Progress": "blue",
  Paused: "orange",
  Completed: "green",
  Closed: "gray",
  Cancelled: "red"
};

function JobStatus({ status }: { status: string | null }) {
  if (!status) return null;
  const color = STATUS_COLORS[status] ?? "gray";
  return (
    <Status color={color}>{status === "Ready" ? "Released" : status}</Status>
  );
}

export default function JobsRoute() {
  const { isPhone } = useViewport();
  const { t } = useLingui();
  const { id: userId, company } = useUser();
  const { jobs, workCenters, trackedEntities } = useLoaderData<typeof loader>();
  const [searchTerm, setSearchTerm] = useState("");
  const [storedWorkCenterIds, setStoredWorkCenterIds] = useLocalStorage<
    string[]
  >(`${WORK_CENTER_FILTER_KEY}:${userId}:${company.id}`, []);

  const workCenterOptions = useMemo(
    () => workCenters.map((wc) => ({ label: wc.name, value: wc.id })),
    [workCenters]
  );

  // A stored id from another location, or a work center since deactivated,
  // must not hide every job.
  const selectedWorkCenterIds = useMemo(() => {
    const available = new Set(workCenters.map((wc) => wc.id));
    return storedWorkCenterIds.filter((id) => available.has(id));
  }, [storedWorkCenterIds, workCenters]);

  const filteredJobs = useMemo(() => {
    const selected = new Set(selectedWorkCenterIds);
    const term = searchTerm.toLowerCase();
    return (jobs as Job[]).filter(
      (job) =>
        (selected.size === 0 ||
          job.workCenterIds.some((id) => selected.has(id))) &&
        (!term ||
          job.jobId?.toLowerCase().includes(term) ||
          job.itemReadableIdWithRevision?.toLowerCase().includes(term) ||
          job.name?.toLowerCase().includes(term))
    );
  }, [jobs, searchTerm, selectedWorkCenterIds]);

  const isFiltered = searchTerm !== "" || selectedWorkCenterIds.length > 0;
  const clearFilters = () => {
    setSearchTerm("");
    setStoredWorkCenterIds([]);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Jobs</Trans>} />
      <MesQueueHeader title={<Trans>Open Jobs</Trans>} />

      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <div className="p-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label={t`Search jobs`}
                placeholder={t`Search by job or item ID`}
                className="pl-8"
              />
            </div>
            {/* Fixed slot, so the clear button doesn't shrink the search box. */}
            <div className="flex sm:w-80 sm:shrink-0">
              <MultiSelect
                aria-label={t`Filter by work center`}
                placeholder={t`All work centers`}
                options={workCenterOptions}
                value={selectedWorkCenterIds}
                onChange={setStoredWorkCenterIds}
                isClearable
                maxPreview={2}
              />
            </div>
          </div>

          {filteredJobs.length > 0 ? (
            <>
              {isPhone ? (
                <ul className="flex flex-col -mx-4 border-y divide-y">
                  {filteredJobs.map((job) => {
                    const trackingId = job.jobMakeMethodId
                      ? trackedEntities[job.jobMakeMethodId]
                      : null;

                    return (
                      <li key={job.id}>
                        <Link
                          to={path.to.jobDag(job.id)}
                          className="flex flex-col gap-1 px-4 py-3 min-h-11"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="font-medium text-foreground">
                                {job.jobId}
                              </span>
                              {trackingId && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {trackingId}
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <EmployeeAvatar employeeId={job.assignee} />
                              <span className="text-sm text-foreground tabular-nums">
                                {job.quantity ?? "—"}
                              </span>
                            </span>
                          </div>
                          <div className="flex min-w-0 gap-1 text-sm">
                            <span className="shrink-0">
                              {job.itemReadableIdWithRevision ?? "—"}
                            </span>
                            {job.name && (
                              <span className="truncate text-muted-foreground">
                                · {job.name}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <JobStatus status={job.status} />
                            <span>{job.deadlineType ?? "—"}</span>
                            <DateTime
                              value={job.dueDate}
                              variant="date"
                              fallback="—"
                            />
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div>
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>
                          <Trans>Job</Trans>
                        </Th>
                        <Th>
                          <Trans>Item</Trans>
                        </Th>
                        <Th>
                          <Trans>Quantity</Trans>
                        </Th>
                        <Th>
                          <Trans>Tracking</Trans>
                        </Th>
                        <Th>
                          <Trans>Assignee</Trans>
                        </Th>
                        <Th>
                          <Trans>Due Date</Trans>
                        </Th>
                        <Th>
                          <Trans>Deadline</Trans>
                        </Th>
                        <Th>
                          <Trans>Status</Trans>
                        </Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {filteredJobs.map((job) => {
                        const trackingId = job.jobMakeMethodId
                          ? trackedEntities[job.jobMakeMethodId]
                          : null;

                        return (
                          <Tr key={job.id}>
                            <Td>
                              <Link
                                to={path.to.jobDag(job.id)}
                                className="font-medium text-foreground hover:underline"
                              >
                                {job.jobId}
                              </Link>
                            </Td>
                            <Td>
                              <VStack spacing={0}>
                                <span>
                                  {job.itemReadableIdWithRevision ?? "—"}
                                </span>
                                {job.name && (
                                  <span className="text-xs text-muted-foreground">
                                    {job.name}
                                  </span>
                                )}
                              </VStack>
                            </Td>
                            <Td className="text-muted-foreground">
                              {job.quantity ?? "—"}
                            </Td>
                            <Td className="text-muted-foreground">
                              {trackingId ?? "—"}
                            </Td>
                            <Td>
                              <EmployeeAvatar employeeId={job.assignee} />
                            </Td>
                            <Td className="text-muted-foreground">
                              <DateTime
                                value={job.dueDate}
                                variant="date"
                                fallback="—"
                              />
                            </Td>
                            <Td className="text-muted-foreground">
                              {job.deadlineType ?? "—"}
                            </Td>
                            <Td>
                              <JobStatus status={job.status} />
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                </div>
              )}
            </>
          ) : isFiltered ? (
            <MesEmptyState
              className="py-16"
              title={<Trans>No results</Trans>}
              action={
                <Button onClick={clearFilters}>
                  <Trans>Clear Filters</Trans>
                </Button>
              }
            />
          ) : (
            <MesEmptyState
              className="py-16"
              title={<Trans>No open jobs</Trans>}
            />
          )}
        </div>
      </div>
    </div>
  );
}
