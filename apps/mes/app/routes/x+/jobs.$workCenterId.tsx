import {
  Card,
  CardContent,
  CardHeader,
  cn,
  Heading,
  HStack,
  Input,
  ResizablePanel,
  ScrollArea,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import {
  LuAlertTriangle,
  LuCheckCircle,
  LuClipboardCheck,
  LuSearch,
  LuTimer,
  LuXCircle,
} from "react-icons/lu";
import { defaultLayout } from "~/utils/layout";

import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import { Link, useLoaderData, useNavigate, useParams } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { BsExclamationSquareFill } from "react-icons/bs";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import type { Operation, OperationSettings } from "~/services/jobs";
import {
  getJobOperationsByWorkCenter,
  getWorkCentersByLocation,
} from "~/services/jobs";
import {
  getLocationAndWorkCenter,
  setLocationAndWorkCenter,
} from "~/services/location.server";
import { makeDurationsAndProgress } from "~/utils/jobs";
import { path } from "~/utils/path";

// TODO: load dynamically
const operationSettings: OperationSettings = {
  showCustomer: false,
  showDescription: true,
  showDueDate: true,
  showDuration: true,
  showEmployee: false,
  showProgress: false,
  showStatus: true,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { workCenterId } = params;
  if (!workCenterId) throw notFound("workCenterId not found");
  const [location, workCenter] = await getLocationAndWorkCenter(
    request,
    client,
    {
      companyId,
      userId,
    }
  );

  const [operations, workCenters] = await Promise.all([
    getJobOperationsByWorkCenter(client, {
      locationId: location,
      workCenterId: workCenterId,
    }),
    getWorkCentersByLocation(client, location),
  ]);

  const payload = {
    operations: operations.data?.map(makeDurationsAndProgress) ?? [],
    workCenters: workCenters.data ?? [],
  };

  if (workCenter !== workCenterId) {
    const locationId =
      workCenters.data?.find((wc) => wc.id === workCenterId)?.locationId ??
      location;
    return json(payload, {
      headers: {
        "Set-Cookie": setLocationAndWorkCenter(locationId, workCenterId),
      },
    });
  }

  return json(payload);
}

export default function JobsRoute() {
  const { operations, workCenters } = useLoaderData<typeof loader>();
  console.log({ operations });
  const { workCenterId } = useParams();
  if (!workCenterId) throw new Error("workCenterId not found");
  const navigate = useNavigate();

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
            <div className="flex justify-between gap-4">
              <div className="flex flex-grow">
                <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  // value={input}
                  // onChange={onSearchChange}
                  placeholder="Search"
                  className="pl-8"
                />
              </div>
              <div className="flex flex-shrink basis-64">
                <Select
                  value={workCenterId}
                  onValueChange={(value) => {
                    navigate(path.to.jobs(value));
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
            operations={operations.filter((operation) =>
              ["In Progress", "Ready", "Todo"].includes(
                operation.operationStatus
              )
            )}
            {...operationSettings}
          />
        </TabsContent>
        <TabsContent value="all" className="p-4 pt-0">
          <OperationsList
            key={`all-${workCenterId}`}
            operations={operations}
            {...operationSettings}
          />
        </TabsContent>
      </Tabs>
    </ResizablePanel>
  );
}

type OperationsListProps = OperationSettings & {
  operations: Operation[];
};

function OperationsList({ operations, ...settings }: OperationsListProps) {
  const { operationId } = useParams();
  console.log({ operations });
  return operations.length > 0 ? (
    <ScrollArea className="h-[calc(100vh-120px)]">
      <div className="flex flex-col gap-2">
        {operations.map((operation) => (
          <OperationCard
            key={operation.id}
            operation={operation}
            isSelected={operationId === operation.id}
            {...settings}
          />
        ))}
      </div>
    </ScrollArea>
  ) : (
    <div className="flex flex-col w-full h-[calc(100vh-120px)] items-center justify-center gap-4">
      <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
        <LuAlertTriangle className="h-6 w-6" />
      </div>
      <span className="text-lg font-mono font-light text-foreground uppercase">
        No scheduled jobs
      </span>
    </div>
  );
}

type OperationCardProps = {
  isSelected: boolean;
  operation: Operation;
} & OperationSettings;

function OperationCard({
  operation,
  isSelected = false,
  showCustomer,
  showDescription,
  showDueDate,
  showDuration,
  showEmployee,
  showProgress,
  showStatus,
}: OperationCardProps) {
  const isOverdue =
    operation.jobDeadlineType !== "No Deadline" && operation.jobDueDate
      ? new Date(operation.jobDueDate) < new Date()
      : false;

  return (
    <Link to={operation.id}>
      <Card
        className={cn("cursor-pointer", isSelected && "from-muted to-muted")}
      >
        <CardHeader className={cn("max-w-full p-3 border-b relative")}>
          <div className="flex w-full max-w-full justify-between">
            <div className="flex flex-col space-y-0">
              {operation.itemReadableId && (
                <span className="text-xs text-muted-foreground truncate">
                  {operation.itemReadableId}
                </span>
              )}
              <span className="mr-auto font-semibold truncate">
                {operation.jobReadableId}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 space-y-2 text-left whitespace-pre-wrap text-sm">
          {showDescription && operation.description && (
            <HStack className="justify-start space-x-2">
              <LuClipboardCheck className="text-muted-foreground" />
              <span className="text-sm">{operation.description}</span>
            </HStack>
          )}
          {showStatus && operation.operationStatus && (
            <HStack className="justify-start space-x-2">
              {getStatusIcon(operation.operationStatus)}
              <span className="text-sm">{operation.operationStatus}</span>
            </HStack>
          )}
          {showDuration && operation.duration && (
            <HStack className="justify-start space-x-2">
              <LuTimer className="text-muted-foreground" />
              <span className="text-sm">
                {formatDurationMilliseconds(operation.duration)}
              </span>
            </HStack>
          )}
          {showDueDate && operation.jobDeadlineType && (
            <HStack className="justify-start space-x-2">
              {getDeadlineIcon(operation.jobDeadlineType, isOverdue)}
              <Tooltip>
                <TooltipTrigger>
                  <span
                    className={cn("text-sm", isOverdue ? "text-red-500" : "")}
                  >
                    {["ASAP", "No Deadline"].includes(operation.jobDeadlineType)
                      ? getDeadlineText(operation.jobDeadlineType)
                      : operation.jobDueDate
                      ? `Due ${formatRelativeTime(
                          convertDateStringToIsoString(operation.jobDueDate)
                        )}`
                      : "–"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {getDeadlineText(operation.jobDeadlineType)}
                </TooltipContent>
              </Tooltip>
            </HStack>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

export function getStatusIcon(status: Operation["operationStatus"]) {
  switch (status) {
    case "Ready":
    case "Todo":
      return <TodoStatusIcon className="text-foreground" />;
    case "Waiting":
    case "Canceled":
      return <LuXCircle className="text-muted-foreground" />;
    case "Done":
      return <LuCheckCircle className="text-blue-600" />;
    case "In Progress":
      return <AlmostDoneIcon />;
    case "Paused":
      return <InProgressStatusIcon />;
    default:
      return null;
  }
}

export function getDeadlineIcon(
  deadlineType: Operation["jobDeadlineType"],
  overdue: boolean
) {
  switch (deadlineType) {
    case "ASAP":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "Hard Deadline":
      return <HighPriorityIcon className={cn(overdue ? "text-red-500" : "")} />;
    case "Soft Deadline":
      return (
        <MediumPriorityIcon className={cn(overdue ? "text-red-500" : "")} />
      );
    case "No Deadline":
      return <LowPriorityIcon />;
  }
}

export function getDeadlineText(deadlineType: Operation["jobDeadlineType"]) {
  switch (deadlineType) {
    case "ASAP":
      return "ASAP";
    case "Hard Deadline":
      return "Hard deadline";
    case "Soft Deadline":
      return "Soft deadline";
    case "No Deadline":
      return "No deadline";
  }
}
