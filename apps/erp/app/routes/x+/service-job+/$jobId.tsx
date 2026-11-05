// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { storage } from "@carbon/files";
import type { JSONContent } from "@carbon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  RecordOutlet,
  VStack
} from "@carbon/react";
import { isServiceJobLocked, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getServiceJob,
  getServiceJobEstimateLines,
  getServiceJobItems,
  getServiceJobTime
} from "~/modules/service/service.service";
import { ServiceJobExplorer } from "~/modules/service/ui/ServiceJob/ServiceJobExplorer";
import ServiceJobHeader from "~/modules/service/ui/ServiceJob/ServiceJobHeader";
import {
  ServiceJobFiles,
  ServiceJobNotes,
  ServiceJobProblem
} from "~/modules/service/ui/ServiceJob/ServiceJobNotes";
import ServiceJobProperties from "~/modules/service/ui/ServiceJob/ServiceJobProperties";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [{ table: "serviceJob", column: "id", param: "jobId" }],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Jobs`, to: path.to.serviceJobs },
    (data) => data?.job?.serviceJobId
  ),
  module: "service"
};

async function getServiceJobFiles(
  client: Parameters<typeof getServiceJob>[0],
  companyId: string,
  jobId: string
) {
  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/service-job/${jobId}`);
  return result.data ?? [];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const [job, time, items, estimateLines, companySettings] = await Promise.all([
    getServiceJob(client, jobId),
    getServiceJobTime(client, jobId),
    getServiceJobItems(client, jobId),
    getServiceJobEstimateLines(client, jobId),
    getCompanySettings(client, companyId)
  ]);

  if (job.error || !job.data || job.data.companyId !== companyId) {
    throw redirect(
      path.to.serviceJobs,
      await flash(request, error(job.error, "Failed to load service job"))
    );
  }

  return {
    job: job.data,
    time: time.data ?? [],
    items: items.data ?? [],
    estimateLines: estimateLines.data ?? [],
    laborCostRate: companySettings.data?.serviceLaborCostRate ?? null,
    files: getServiceJobFiles(client, companyId, jobId)
  };
}

export default function ServiceJobRoute() {
  const { t } = useLingui();
  const { jobId } = useParams();
  const { job, time, items, estimateLines, laborCostRate, files } =
    useLoaderData<typeof loader>();

  if (!jobId) throw new Error("Could not find jobId");

  const isLocked = isServiceJobLocked(job.status);
  // Time cannot be logged without the cost rate, nor billed without the
  // job's bill rate.
  // The company's cost rate is a setting; a job's bill rate is on the job.
  const isMissingCostRate = !isLocked && laborCostRate === null;
  const isMissingBillRate =
    !isLocked &&
    !isMissingCostRate &&
    job.coverage === "Billable" &&
    job.laborBillRate === null;

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <ServiceJobHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorerLabel={t`Work`}
              explorer={
                <ServiceJobExplorer
                  estimateLines={estimateLines}
                  time={time}
                  items={items}
                />
              }
              content={
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    {isMissingCostRate && (
                      <Alert variant="warning">
                        <LuTriangleAlert />
                        <AlertTitle>
                          <Trans>
                            Labor rates are not set. Time cannot be logged or
                            billed until they are.
                          </Trans>
                        </AlertTitle>
                        <AlertDescription>
                          <Link
                            to={path.to.serviceSettings}
                            className="font-medium hover:underline"
                          >
                            <Trans>Set rates</Trans>
                          </Link>
                        </AlertDescription>
                      </Alert>
                    )}
                    {isMissingBillRate && (
                      <Alert variant="warning">
                        <LuTriangleAlert />
                        <AlertTitle>
                          <Trans>
                            This job has no bill rate. Set Bill Rate in its
                            properties before its time can be billed.
                          </Trans>
                        </AlertTitle>
                      </Alert>
                    )}
                    <ServiceJobProblem
                      key={`problem-${jobId}`}
                      id={jobId}
                      problem={(job.problem ?? {}) as JSONContent}
                      repairable={job.repairable}
                      isDisabled={isLocked}
                    />
                    <ServiceJobNotes
                      key={`findings-${jobId}`}
                      id={jobId}
                      field="findings"
                      content={(job.findings ?? {}) as JSONContent}
                      isDisabled={isLocked}
                    />
                    <ServiceJobNotes
                      key={`resolution-${jobId}`}
                      id={jobId}
                      field="resolution"
                      content={(job.resolution ?? {}) as JSONContent}
                      isDisabled={isLocked}
                    />
                    <ServiceJobFiles
                      jobId={jobId}
                      files={files}
                      isDisabled={isLocked}
                    />
                    <RecordOutlet />
                  </VStack>
                </div>
              }
              properties={<ServiceJobProperties key={jobId} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
