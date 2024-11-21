import {
  Card,
  CardContent,
  CardHeader,
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import { Link } from "@remix-run/react";
import { LuClipboardCheck, LuTimer } from "react-icons/lu";
import type {
  Operation,
  OperationSettings,
} from "~/services/operations.service";
import { path } from "~/utils/path";
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

export function OperationsList({ operations }: OperationsListProps) {
  return (
    <>
      {operations.map((operation) => (
        <OperationCard key={operation.id} operation={operation} {...settings} />
      ))}
    </>
  );
}

type OperationCardProps = {
  operation: Operation;
} & OperationSettings;

function OperationCard({
  operation,
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
    <Link to={path.to.operation(operation.id)}>
      <Card className="cursor-pointer shadow">
        <CardHeader className={cn("max-w-full p-3 border-b relative")}>
          <div className="flex w-full max-w-full justify-between">
            <div className="flex flex-col space-y-0">
              {operation.itemReadableId && (
                <span className="text-xs text-muted-foreground line-clamp-1">
                  {operation.itemReadableId}
                </span>
              )}
              <span className="mr-auto font-semibold line-clamp-1">
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
