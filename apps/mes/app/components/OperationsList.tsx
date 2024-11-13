import {
  Card,
  CardContent,
  CardHeader,
  cn,
  HStack,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import { Link, useParams } from "@remix-run/react";
import { LuAlertTriangle, LuClipboardCheck, LuTimer } from "react-icons/lu";
import type {
  Operation,
  OperationSettings,
} from "~/services/operations.service";
import { DeadlineIcon, OperationStatusIcon } from "./Icons";

type OperationsListProps = {
  operations: Operation[];
  emptyMessage?: string;
};

const settings = {
  showCustomer: false,
  showDescription: true,
  showDueDate: true,
  showDuration: true,
  showEmployee: false,
  showProgress: false,
  showStatus: true,
}; // TODO: load dynamically

export function OperationsList({
  operations,
  emptyMessage = "No scheduled operations",
}: OperationsListProps) {
  const { operationId } = useParams();

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
        {emptyMessage}
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
        className={cn(
          "cursor-pointer shadow",
          isSelected && "from-muted via-muted"
        )}
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
              <OperationStatusIcon status={operation.operationStatus} />
              <span className="text-sm">{operation.operationStatus}</span>
            </HStack>
          )}
          {showDuration && typeof operation.duration === "number" && (
            <HStack className="justify-start space-x-2">
              <LuTimer className="text-muted-foreground" />
              <span className="text-sm">
                {formatDurationMilliseconds(operation.duration)}
              </span>
            </HStack>
          )}
          {showDueDate && operation.jobDeadlineType && (
            <HStack className="justify-start space-x-2">
              <DeadlineIcon
                deadlineType={operation.jobDeadlineType}
                overdue={isOverdue}
              />
              <Tooltip>
                <TooltipTrigger>
                  <span
                    className={cn("text-sm", isOverdue ? "text-red-500" : "")}
                  >
                    {["ASAP", "No Deadline"].includes(operation.jobDeadlineType)
                      ? operation.jobDeadlineType
                      : operation.jobDueDate
                      ? `Due ${formatRelativeTime(
                          convertDateStringToIsoString(operation.jobDueDate)
                        )}`
                      : "–"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {operation.jobDeadlineType}
                </TooltipContent>
              </Tooltip>
            </HStack>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
