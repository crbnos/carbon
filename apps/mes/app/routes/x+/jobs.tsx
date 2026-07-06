import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Button,
  Heading,
  Input,
  SidebarTrigger,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuSearch, LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import { userContext } from "~/context";
import {
  getOpenJobs,
  getTrackedEntitiesByJobMakeMethodIds
} from "~/services/operations.service";
import { path } from "~/utils/path";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();
  const locationId = context.get(userContext)?.locationId;

  const jobs = await getOpenJobs(serviceRole, { companyId, locationId });

  if (jobs.error) {
    console.error("getOpenJobs error:", jobs.error);
  }

  const jobMakeMethodIds = (jobs.data ?? []).reduce<string[]>((acc, job) => {
    if (job.jobMakeMethodId) acc.push(job.jobMakeMethodId);
    return acc;
  }, []);

  const trackedEntities = await getTrackedEntitiesByJobMakeMethodIds(
    serviceRole,
    jobMakeMethodIds,
    companyId
  );

  return {
    jobs: jobs.data ?? [],
    trackedEntities
  };
}

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

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value + "T00:00:00");
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export default function JobsRoute() {
  const { t } = useLingui();
  const { jobs, trackedEntities } = useLoaderData<typeof loader>();
  const [searchTerm, setSearchTerm] = useState("");

  const filteredJobs = useMemo(() => {
    if (!searchTerm) return jobs as Job[];
    const term = searchTerm.toLowerCase();
    return (jobs as Job[]).filter(
      (job) =>
        job.jobId?.toLowerCase().includes(term) ||
        job.itemReadableIdWithRevision?.toLowerCase().includes(term) ||
        job.name?.toLowerCase().includes(term)
    );
  }, [jobs, searchTerm]);

  return (
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">
            <Trans>Open Jobs</Trans>
          </Heading>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <div className="p-4">
          <div className="relative mb-4">
            <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t`Search by job or item ID`}
              className="pl-8"
            />
          </div>

          {filteredJobs.length > 0 ? (
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
                          <span>{job.itemReadableIdWithRevision ?? "—"}</span>
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
                        {formatDate(job.dueDate)}
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
          ) : searchTerm ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                <LuTriangleAlert className="h-6 w-6" />
              </div>
              <span className="text-xs font-mono font-light text-foreground uppercase">
                <Trans>No results</Trans>
              </span>
              <Button onClick={() => setSearchTerm("")}>
                <Trans>Clear Search</Trans>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                <LuTriangleAlert className="h-6 w-6" />
              </div>
              <span className="text-xs font-mono font-light text-foreground uppercase">
                <Trans>No open jobs</Trans>
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
