import {
  ClientOnly,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  VStack,
} from "@carbon/react";
import {
  json,
  Outlet,
  redirect,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { flattenTree } from "~/components/TreeView";
import {
  getJob,
  getJobDocuments,
  getJobMethodTree,
  JobBoMExplorer,
  JobHeader,
} from "~/modules/production";
import JobBreadcrumbs from "~/modules/production/ui/Jobs/JobBreadcrumbs";
import {} from "~/modules/sales";
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

  const method = await getJobMethodTree(client, jobId);

  if (method.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(method.error, "Failed to load job method"))
    );
  }

  return json({
    job: job.data,
    files: files,
    method: method.data ?? [],
  });
}

export default function JobRoute() {
  const params = useParams();
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const { method } = useLoaderData<typeof loader>();
  const flattenedTree = method.length > 0 ? flattenTree(method[0]) : [];

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
                    className="bg-card h-full"
                  >
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <div className="grid w-full h-full overflow-hidden p-2">
                        <JobBoMExplorer method={flattenedTree} />
                      </div>
                    </ScrollArea>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel order={2}>
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <VStack spacing={2} className="p-2">
                        <JobBreadcrumbs />
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
