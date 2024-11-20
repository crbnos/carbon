import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ClientOnly } from "@carbon/react";
import {
  Await,
  defer,
  Outlet,
  redirect,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { Suspense } from "react";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { ExplorerSkeleton } from "~/components/Skeletons";
import { flattenTree } from "~/components/TreeView";
import {
  getJob,
  getJobDocuments,
  getJobMethodTree,
  JobBoMExplorer,
  JobHeader,
  JobProperties,
} from "~/modules/production";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Jobs",
  to: path.to.jobs,
  module: "production",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "production",
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const serviceRole = await getCarbonServiceRole();
  const [job, tags] = await Promise.all([
    getJob(serviceRole, jobId),
    getTagsList(serviceRole, companyId, "job"),
  ]);

  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to load job"))
    );
  }

  return defer({
    job: job.data,
    tags: tags.data ?? [],
    files: getJobDocuments(serviceRole, companyId, job.data),
    method: getJobMethodTree(serviceRole, jobId), // returns a promise
  });
}

export default function JobRoute() {
  const params = useParams();
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const { method } = useLoaderData<typeof loader>();

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <JobHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ClientOnly fallback={null}>
              {() => (
                <ResizablePanels
                  explorer={
                    <div className="grid w-full h-[calc(100dvh-99px)] overflow-hidden p-2">
                      <Suspense fallback={<ExplorerSkeleton />}>
                        <Await
                          resolve={method}
                          errorElement={
                            <div className="p-2 text-red-500">
                              Error loading job tree.
                            </div>
                          }
                        >
                          {(resolvedMethod) => (
                            <JobBoMExplorer
                              method={
                                resolvedMethod.data &&
                                resolvedMethod.data.length > 0
                                  ? flattenTree(resolvedMethod.data[0])
                                  : []
                              }
                            />
                          )}
                        </Await>
                      </Suspense>
                    </div>
                  }
                  content={
                    <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                      <Outlet />
                    </div>
                  }
                  properties={<JobProperties />}
                />
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
