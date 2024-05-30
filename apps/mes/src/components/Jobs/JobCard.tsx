import {
  Card,
  CardContent,
  CardHeader,
  HStack,
  Progress,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";

import { BsExclamationSquareFill } from "react-icons/bs";
import {
  LuCheckCircle,
  LuClipboardCheck,
  LuTimer,
  LuXCircle,
} from "react-icons/lu";
import { useNavigate } from "react-router-dom";

import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
// import CustomerAvatar from "~/components/CustomerAvatar";
// import EmployeeAvatarGroup from "~/components/EmployeeAvatarGroup";

import type { Job, JobSettings } from "~/types";

type JobCardProps = {
  job: Job;
  isSelected?: boolean;
} & JobSettings;

export function JobCard({
  job,
  isSelected = false,
  showCustomer,
  showDescription,
  showDueDate,
  showDuration,
  showEmployee,
  showProgress,
  showStatus,
}: JobCardProps) {
  const navigate = useNavigate();
  const isOverdue =
    job.deadlineType !== "NO_DEADLINE" && job.dueDate
      ? new Date(job.dueDate) < new Date()
      : false;

  return (
    <Card
      onClick={() => navigate(job.id)}
      className={cn("cursor-pointer", isSelected && "from-muted to-muted")}
    >
      <CardHeader className={cn("max-w-full p-3 border-b relative")}>
        <div className="flex w-full max-w-full justify-between">
          <div className="flex flex-col space-y-0">
            {job.part && (
              <span className="text-xs text-muted-foreground truncate">
                {job.part}
              </span>
            )}
            <span className="mr-auto font-semibold truncate">
              {job.readableId}
            </span>
          </div>
        </div>

        {showProgress &&
          ["PAUSED", "DONE", "IN_PROGRESS"].includes(job.status!) && (
            <Progress
              indicatorClassName={
                job.status === "PAUSED" ? "bg-yellow-500" : ""
              }
              leftLabel={
                job.progress ? formatDurationMilliseconds(job.progress) : ""
              }
              rightLabel={
                job.duration ? formatDurationMilliseconds(job.duration) : ""
              }
              value={
                job.progress && job.duration
                  ? (job.progress / job.duration) * 100
                  : 0
              }
            />
          )}
      </CardHeader>
      <CardContent className="p-3 space-y-2 text-left whitespace-pre-wrap text-sm">
        {showDescription && job.description && (
          <HStack className="justify-start space-x-2">
            <LuClipboardCheck className="text-muted-foreground" />
            <span className="text-sm">{job.description}</span>
          </HStack>
        )}
        {showStatus && job.status && (
          <HStack className="justify-start space-x-2">
            {getStatusIcon(job.status)}
            <span className="text-sm">{getStatusText(job.status)}</span>
          </HStack>
        )}
        {showDuration && job.duration && (
          <HStack className="justify-start space-x-2">
            <LuTimer className="text-muted-foreground" />
            <span className="text-sm">
              {formatDurationMilliseconds(job.duration)}
            </span>
          </HStack>
        )}
        {showDueDate && job.deadlineType && (
          <HStack className="justify-start space-x-2">
            {getDeadlineIcon(job.deadlineType, isOverdue)}
            <Tooltip>
              <TooltipTrigger>
                <span
                  className={cn("text-sm", isOverdue ? "text-red-500" : "")}
                >
                  {["ASAP", "NO_DEADLINE"].includes(job.deadlineType)
                    ? getDeadlineText(job.deadlineType)
                    : job.dueDate
                    ? `Due ${formatRelativeTime(
                        convertDateStringToIsoString(job.dueDate)
                      )}`
                    : "–"}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {getDeadlineText(job.deadlineType)}
              </TooltipContent>
            </Tooltip>
          </HStack>
        )}

        {/* {showCustomer && job.customerId && (
          <HStack className="justify-start space-x-2">
            <LuFactory className="text-muted-foreground" />
            <CustomerAvatar customerId={job.customerId} />
          </HStack>
        )}

        {showEmployee && job.employeeIds && (
          <HStack className="justify-start space-x-2">
            <LuUsers className="text-muted-foreground" />
            <EmployeeAvatarGroup employeeIds={job.employeeIds} />
          </HStack>
        )} */}
      </CardContent>
    </Card>
  );
}

export function getStatusIcon(status: Job["status"]) {
  switch (status) {
    case "READY":
    case "TODO":
      return <TodoStatusIcon className="text-foreground" />;
    case "WAITING":
    case "CANCELED":
      return <LuXCircle className="text-muted-foreground" />;
    case "DONE":
      return <LuCheckCircle className="text-blue-600" />;
    case "IN_PROGRESS":
      return <AlmostDoneIcon />;
    case "PAUSED":
      return <InProgressStatusIcon />;
    default:
      return null;
  }
}

export function getStatusText(status: Job["status"], overdue: boolean = false) {
  switch (status) {
    case "READY":
      return "Ready";
    case "TODO":
      return "Todo";
    case "WAITING":
      return "Waiting";
    case "CANCELED":
      return "Canceled";
    case "DONE":
      return "Done";
    case "IN_PROGRESS":
      return "In progress";
    case "PAUSED":
      return "Paused";
  }
}

export function getDeadlineIcon(
  deadlineType: Job["deadlineType"],
  overdue: boolean
) {
  switch (deadlineType) {
    case "ASAP":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "HARD_DEADLINE":
      return <HighPriorityIcon className={cn(overdue ? "text-red-500" : "")} />;
    case "SOFT_DEADLINE":
      return (
        <MediumPriorityIcon className={cn(overdue ? "text-red-500" : "")} />
      );
    case "NO_DEADLINE":
      return <LowPriorityIcon />;
  }
}

export function getDeadlineText(deadlineType: Job["deadlineType"]) {
  switch (deadlineType) {
    case "ASAP":
      return "ASAP";
    case "HARD_DEADLINE":
      return "Hard deadline";
    case "SOFT_DEADLINE":
      return "Soft deadline";
    case "NO_DEADLINE":
      return "No deadline";
  }
}
