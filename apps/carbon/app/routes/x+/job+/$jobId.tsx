import {
  ClientOnly,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  VStack,
} from "@carbon/react";
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
import { ExplorerSkeleton } from "~/components/Skeletons";
import { flattenTree } from "~/components/TreeView";
import {
  getJob,
  getJobDocuments,
  getJobMethodTree,
  JobBoMExplorer,
  JobHeader,
} from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Jobs",
  to: path.to.jobs,
  module: "production",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const job = await getJob(client, jobId);

  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to load job"))
    );
  }

  const files = await getJobDocuments(client, companyId, job.data);

  return defer({
    job: job.data,
    files,
    method: getJobMethodTree(client, jobId), // returns a promise
  });
}

export default function JobRoute() {
  const params = useParams();
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const { method } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <JobHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <div className="flex flex-grow overflow-hidden">
            <ClientOnly fallback={null}>
              {() => (
                <ResizablePanelGroup direction="horizontal">
                  <ResizablePanel
                    order={1}
                    minSize={10}
                    defaultSize={20}
                    className="bg-card h-full shadow-lg"
                  >
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <div className="grid w-full h-full overflow-hidden p-2">
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
                    </ScrollArea>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel order={2}>
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <VStack spacing={2}>
                        <Outlet />
                      </VStack>
                    </ScrollArea>
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </div>
  );
}
