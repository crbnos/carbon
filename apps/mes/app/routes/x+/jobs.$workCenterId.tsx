import {
  Heading,
  Input,
  ResizablePanel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@carbon/react";
import { LuSearch } from "react-icons/lu";
import { defaultLayout } from "~/utils/layout";

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Outlet,
  useLoaderData,
  useNavigate,
  useParams,
} from "@remix-run/react";
import { json, redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { useMemo, useState } from "react";
import { OperationsList } from "~/components";
import {
  getJobOperationsByWorkCenter,
  getWorkCenter,
  getWorkCentersByLocation,
} from "~/services/jobs.service";
import {
  getLocationAndWorkCenter,
  setLocationAndWorkCenter,
} from "~/services/location.server";
import { makeDurations } from "~/utils/jobs";
import { path } from "~/utils/path";

// TODO: it's possible that the location cookie and the work cell become out of sync.
//       we should probably include the location in the url param when using work centers

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { workCenterId } = params;
  if (!workCenterId) throw notFound("workCenterId not found");
  const { location: currentLocation, workCenter: currentWorkCenter } =
    await getLocationAndWorkCenter(request, client, {
      companyId,
      userId,
    });

  const workCenter = await getWorkCenter(client, workCenterId);
  if (workCenter.error) {
    throw redirect(
      path.to.jobs,
      await flash(
        request,
        error(workCenter.error, "Failed to fetch work center")
      )
    );
  }

  const [operations, workCenters] = await Promise.all([
    getJobOperationsByWorkCenter(client, {
      locationId: workCenter.data.locationId!,
      workCenterId: workCenterId,
    }),
    getWorkCentersByLocation(client, workCenter.data.locationId!),
  ]);

  const payload = {
    operations: operations.data?.map(makeDurations) ?? [],
    workCenters: workCenters.data ?? [],
  };

  if (
    currentWorkCenter !== workCenterId ||
    currentLocation !== workCenter.data?.locationId
  ) {
    return json(payload, {
      headers: {
        "Set-Cookie": setLocationAndWorkCenter(
          workCenter.data.locationId! ?? currentLocation,
          workCenter.data.id
        ),
      },
    });
  }

  return json(payload);
}

export default function JobsRoute() {
  const { operations, workCenters } = useLoaderData<typeof loader>();
  const [searchTerm, setSearchTerm] = useState("");

  const { workCenterId } = useParams();
  if (!workCenterId) throw new Error("workCenterId not found");
  const navigate = useNavigate();

  const filteredOperations = useMemo(() => {
    if (!searchTerm) return operations;
    const lowercasedTerm = searchTerm.toLowerCase();
    return operations.filter(
      (operation) =>
        operation.description?.toLowerCase().includes(lowercasedTerm) ||
        operation.jobReadableId?.toLowerCase().includes(lowercasedTerm) ||
        operation.itemReadableId?.toLowerCase().includes(lowercasedTerm)
    );
  }, [operations, searchTerm]);

  return (
    <>
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
              <div className="flex justify-between gap-4">
                <div className="flex flex-grow">
                  <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search"
                    className="pl-8"
                  />
                </div>
                <div className="flex flex-shrink basis-64">
                  <Select
                    value={workCenterId}
                    onValueChange={(value) => {
                      navigate(path.to.workCenter(value));
                    }}
                  >
                    <SelectTrigger aria-label="Select work cell">
                      <SelectValue placeholder="Select a work cell">
                        {workCenters.find((wc) => wc.id === workCenterId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {workCenters.map((cell) => (
                        <SelectItem key={cell.id} value={cell.id}>
                          {cell.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <TabsContent value="current" className="p-4 pt-0">
            <OperationsList
              key={`current:${workCenterId}`}
              operations={filteredOperations.filter((operation) =>
                ["In Progress", "Ready", "Todo"].includes(
                  operation.operationStatus
                )
              )}
            />
          </TabsContent>
          <TabsContent value="all" className="p-4 pt-0">
            <OperationsList
              key={`all-${workCenterId}`}
              operations={filteredOperations}
            />
          </TabsContent>
        </Tabs>
      </ResizablePanel>
      <Outlet />
    </>
  );
}
