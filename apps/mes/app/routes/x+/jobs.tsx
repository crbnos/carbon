import {
  Heading,
  Input,
  ResizablePanel,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@carbon/react";
import { LuSearch } from "react-icons/lu";
import { defaultLayout } from "~/utils/layout";

import { requirePermissions } from "@carbon/auth/auth.server";
import { useLoaderData } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import {
  getLocationAndWorkCenter,
  setLocationAndWorkCenter,
} from "~/services/location.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const [location, workCenter, updated] = await getLocationAndWorkCenter(
    request,
    client,
    {
      companyId,
      userId,
    }
  );

  const [jobs, workCenters, locations] = await Promise.all([
    client.rpc("get_job_operations_by_work_center", {
      location_id: location,
      work_center_id: workCenter,
    }),
    client.from("workCenter").select("*").eq("locationId", location),
    client.from("location").select("*").eq("companyId", companyId),
  ]);

  const payload = {
    jobs: jobs.data ?? [],
    location,
    locations: locations.data ?? [],
    workCenter,
    workCenters: workCenters.data ?? [],
  };

  if (updated) {
    return json(payload, {
      headers: {
        "Set-Cookie": setLocationAndWorkCenter(location, workCenter),
      },
    });
  }

  return json(payload);
}

export default function JobsRoute() {
  const payload = useLoaderData<typeof loader>();
  return (
    <ResizablePanel defaultSize={defaultLayout[1]} minSize={30}>
      <Tabs defaultValue="current">
        <div className="flex items-center px-4 py-2 h-[52px] bg-background">
          <Heading size="h2">Jobs</Heading>
          <TabsList className="ml-auto">
            <TabsTrigger value="current">Current</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </div>
        <Separator />
        <div className="p-4">
          <div className="relative">
            <div className="flex justify-between">
              <div className="flex flex-grow">
                <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  // value={input}
                  // onChange={onSearchChange}
                  placeholder="Search"
                  className="pl-8"
                />
              </div>
              <div className="flex flex-shrink">
                {/* <WorkCellSelect
                          workCells={workCells}
                          value={selectedWorkCell}
                          onChange={setSelectedWorkCell}
                        /> */}
              </div>
            </div>
          </div>
        </div>

        <TabsContent value="current" className="m-0">
          <pre>{JSON.stringify(payload, null, 2)}</pre>
          {/* <JobsList
                    jobs={workCellJobs.filter((job) =>
                      ["IN_PROGRESS", "PAUSED", "READY", "TODO"].includes(
                        job.status
                      )
                    )}
                    {...jobSettings}
                  /> */}
        </TabsContent>
        <TabsContent value="all" className="m-0">
          {/* <JobsList jobs={workCellJobs} {...jobSettings} /> */}
        </TabsContent>
      </Tabs>
    </ResizablePanel>
  );
}
