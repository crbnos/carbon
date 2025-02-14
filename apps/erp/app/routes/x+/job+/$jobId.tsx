import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Await,
  defer,
  Outlet,
  redirect,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { Suspense, useMemo } from "react";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { ExplorerSkeleton } from "~/components/Skeletons";
import { flattenTree } from "~/components/TreeView";
import { getConfigurationParameters } from "~/modules/items";
import type { JobMethodTreeItem } from "~/modules/production";
import {
  getJob,
  getJobDocuments,
  getJobMethodTree,
} from "~/modules/production";
import {
  JobBoMExplorer,
  JobHeader,
  JobProperties,
} from "~/modules/production/ui/Jobs";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Jobs",
  to: path.to.jobs,
  module: "production",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true,
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const [job, tags] = await Promise.all([
    getJob(client, jobId),
    getTagsList(client, companyId, "job"),
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

  return defer({
    job: job.data,
    tags: tags.data ?? [],
    files: getJobDocuments(client, companyId, job.data),
    method: getJobMethodTree(client, jobId), // returns a promise
    configurationParameters: getConfigurationParameters(
      client,
      job.data.itemId!,
      companyId
    ),
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
                        <JobBoMExplorerWrapper
                          method={resolvedMethod.data ?? []}
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
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}

function JobBoMExplorerWrapper({
  method,
}: {
  method: JobMethodTreeItem[] | null;
}) {
  const memoizedMethod = useMemo(
    () => (method && method.length > 0 ? flattenTree(method[0]) : []),
    [method]
  );
  return <JobBoMExplorer method={memoizedMethod} />;
}
