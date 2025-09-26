import {
  Badge,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  cn,
  Heading,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDate,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import { Link } from "@remix-run/react";
import { cva } from "class-variance-authority";
import {
  LuCalendarDays,
  LuClipboardCheck,
  LuHardHat,
  LuTimer,
} from "react-icons/lu";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import type { Operation, OperationSettings } from "~/services/types";
import { getPrivateUrl, path } from "~/utils/path";
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
  showEmployee: true,
  showProgress: false,
  showStatus: true,
  showThumbnail: true,
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

const cardVariants = cva(
  "bg-card hover:bg-muted/30 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]",
  {
    variants: {
      status: {
        "In Progress": "border-emerald-600/30",
        Ready: "",
        Done: "",
        Paused: "",
        Canceled: "opacity-50 border-red-500",
        Waiting: "opacity-50",
        Todo: "border-border",
      },
    },
    defaultVariants: {
      status: "Todo",
    },
  }
);

function OperationCard({
  operation,
  showCustomer,
  showDescription,
  showDueDate,
  showDuration,
  showEmployee,
  showProgress,
  showStatus,
  showThumbnail,
}: OperationCardProps) {
  const isOverdue =
    operation.jobDeadlineType !== "No Deadline" && operation.jobDueDate
      ? new Date(operation.jobDueDate) < new Date()
      : false;

  return (
    <Card
      className={cn(
        "shadow-sm dark:shadow-sm py-0 h-full flex flex-col",
        cardVariants({
          status: operation.operationStatus,
        })
      )}
    >
      <Link
        to={path.to.operation(operation.id)}
        className="flex flex-col flex-1"
      >
        <CardHeader className="-mx-4 relative border-b py-3 px-4 rounded-t-lg">
          <div className="flex w-full max-w-full justify-between items-start gap-2">
            <div className="flex flex-col space-y-0 min-w-0">
              {operation.itemReadableId && (
                <span className="text-xs text-muted-foreground line-clamp-1">
                  {operation.itemReadableId}
                </span>
              )}
              <span className="mr-auto font-semibold line-clamp-2 leading-tight">
                {operation.itemDescription || operation.itemReadableId}
              </span>
            </div>
            <Heading size="h4" className="text-muted-foreground/70">
              {operation.operationQuantity}
            </Heading>
          </div>
        </CardHeader>
        <CardContent className="pt-3 px-1 gap-2 text-left whitespace-pre-wrap text-sm flex-grow">
          {showThumbnail && operation.thumbnailPath && (
            <div className="flex justify-center">
              <img
                src={getPrivateUrl(operation.thumbnailPath)}
                alt={operation.jobReadableId}
                className="w-full h-auto rounded-lg"
              />
            </div>
          )}
          <HStack className="justify-start space-x-2">
            <LuHardHat className="text-muted-foreground" />
            <span className="text-sm line-clamp-1">
              {operation.jobReadableId}
            </span>
          </HStack>

          {showDescription && operation.description && (
            <HStack className="justify-start space-x-2">
              <LuClipboardCheck className="text-muted-foreground" />
              <span className="text-sm line-clamp-1">
                {operation.description}
              </span>
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
            <>
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
                      {["ASAP", "No Deadline"].includes(
                        operation.jobDeadlineType
                      )
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
              {operation.jobDueDate && (
                <HStack className="justify-start space-x-2">
                  <LuCalendarDays />
                  <span className="text-sm">
                    {formatDate(operation.jobDueDate)}
                  </span>
                </HStack>
              )}
            </>
          )}
        </CardContent>
        {(operation.assignee ||
          (operation.tags && operation.tags.length > 0)) && (
          <CardFooter className="bg-accent/50 -mx-4 border-t px-4 py-2 items-center justify-start space-2 rounded-b-lg text-xs flex-wrap mt-auto">
            {operation.assignee && (
              <EmployeeAvatar size="xs" employeeId={operation.assignee} />
            )}
            {operation.tags?.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="border dark:border-none dark:shadow-button-base"
              >
                {tag}
              </Badge>
            ))}
          </CardFooter>
        )}
      </Link>
    </Card>
  );
}
