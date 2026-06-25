import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Suspense, useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { ExplorerSkeleton } from "~/components/Skeletons";
import { flattenTree } from "~/components/TreeView";
import { getConfigurationParameters } from "~/modules/items";
import type { JobMethodTreeItem } from "~/modules/production";
import {
  getJob,
  getJobDocuments,
  getJobMaterialsWithQuantityOnHand,
  getJobMethodTree,
  getJobOrderStatusMap,
  getTrackedEntitiesByJobId
} from "~/modules/production";
import {
  JobBoMExplorer,
  JobHeader,
  JobProperties
} from "~/modules/production/ui/Jobs";
import type { JobOrderStatusData } from "~/modules/production/ui/Jobs/JobBoMExplorer";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

// Resolves each job material's procurement status for the BoM explorer badge:
// its quantity-on-hand row (for the "needs ordering" shortfall, matching the
// Materials page) and its purchase order lines (looked up by item + location,
// not jobId, since planning-generated POs aren't linked to the job). Returned as
// a promise so the explorer renders immediately and the badges stream in.
async function getJobOrderStatus(
  client: Parameters<typeof getJob>[0],
  jobId: string,
  companyId: string,
  locationId: string,
  jobStatus: string | null | undefined
): Promise<JobOrderStatusData> {
  const materials = await getJobMaterialsWithQuantityOnHand(
    client,
    jobId,
    companyId,
    locationId
  );

  return getJobOrderStatusMap(
    client,
    jobId,
    companyId,
    locationId,
    jobStatus,
    materials.data ?? []
  );
}

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.jobs,
  module: "production"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const [job, tags] = await Promise.all([
    getJob(client, jobId),
    getTagsList(client, companyId, "job")
  ]);

  if (companyId !== job.data?.companyId) {
    throw redirect(path.to.jobs);
  }

  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to load job"))
    );
  }

  return {
    job: job.data,
    tags: tags.data ?? [],
    files: getJobDocuments(client, companyId, job.data),
    trackedEntities: getTrackedEntitiesByJobId(client, jobId),
    method: getJobMethodTree(client, jobId), // returns a promise
    orderStatus: getJobOrderStatus(
      client,
      jobId,
      companyId,
      job.data.locationId ?? "",
      job.data.status
    ), // returns a promise
    configurationParameters: getConfigurationParameters(
      client,
      job.data.itemId!,
      companyId
    )
  };
}

export default function JobRoute() {
  const params = useParams();
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const { method, orderStatus } = useLoaderData<typeof loader>();

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <JobHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={
                <div className="w-full h-full p-2">
                  <Suspense fallback={<ExplorerSkeleton />}>
                    <Await
                      resolve={method}
                      errorElement={
                        <div className="p-2 text-red-500">
                          <Trans>Error loading job tree.</Trans>
                        </div>
                      }
                    >
                      {(resolvedMethod) => (
                        <JobBoMExplorerWrapper
                          method={resolvedMethod.data ?? []}
                          orderStatus={orderStatus}
                        />
                      )}
                    </Await>
                  </Suspense>
                </div>
              }
              content={
                <div className="h-[calc(100dvh-99px)] overflow-hidden w-full">
                  <Outlet />
                </div>
              }
              properties={<JobProperties key={jobId} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}

function JobBoMExplorerWrapper({
  method,
  orderStatus
}: {
  method: JobMethodTreeItem[] | null;
  orderStatus: Promise<JobOrderStatusData>;
}) {
  const memoizedMethod = useMemo(
    () => (method && method.length > 0 ? flattenTree(method[0]) : []),
    [method]
  );
  return <JobBoMExplorer method={memoizedMethod} orderStatus={orderStatus} />;
}
