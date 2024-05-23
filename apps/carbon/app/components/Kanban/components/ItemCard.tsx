import {
  Button,
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
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cva } from "class-variance-authority";
import { BsExclamationSquareFill } from "react-icons/bs";
import {
  LuCheckCircle,
  LuClipboardCheck,
  LuFactory,
  LuGripVertical,
  LuTimer,
  LuUsers,
  LuXCircle,
} from "react-icons/lu";

import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import CustomerAvatar from "~/components/CustomerAvatar";
import EmployeeAvatarGroup from "~/components/EmployeeAvatarGroup";
import type { DisplaySettings, Item, ItemDragData } from "../types";

type ItemCardProps = {
  item: Item;
  isOverlay?: boolean;
} & DisplaySettings;

const cardVariants = cva(
  "bg-gradient-to-tl via-card to-card hover:to-muted/30 hover:via-muted/30",
  {
    variants: {
      dragging: {
        over: "ring-2 ring-primary opacity-30",
        overlay:
          "ring-2 ring-primary hover:from-muted hover:via-muted hover:to-muted",
      },
      status: {
        IN_PROGRESS: "border-green-600/30 from-green-600/10",
        READY: "",
        DONE: "",
        PAUSED: "",
        CANCELED: "",
        WAITING: "border-red-500/30 from-red-500/10",
        TODO: "border-border",
      },
    },
    defaultVariants: {
      status: "TODO",
    },
  }
);

const cardHeaderVariants = cva("border-b", {
  variants: {
    status: {
      IN_PROGRESS: "border-green-600/30",
      READY: "",
      DONE: "",
      PAUSED: "",
      CANCELED: "",
      WAITING: "border-red-500/30",
      TODO: "border-border",
    },
  },
  defaultVariants: {
    status: "TODO",
  },
});

export function ItemCard({
  item,
  isOverlay,
  showCustomer,
  showDescription,
  showDueDate,
  showDuration,
  showEmployee,
  showProgress,
  showStatus,
}: ItemCardProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: "item",
      item,
    } satisfies ItemDragData,
    attributes: {
      roleDescription: "item",
    },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  const isOverdue =
    item.deadlineType !== "NO_DEADLINE" && item.dueDate
      ? new Date(item.dueDate) < new Date()
      : false;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "max-w-[330px]",
        cardVariants({
          dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
          status: item.status,
        })
      )}
    >
      <CardHeader
        className={cn(
          "max-w-full p-3 border-b relative",
          cardHeaderVariants({
            status: item.status,
          })
        )}
      >
        <div className="flex w-full max-w-full justify-between">
          <div className="flex flex-col space-y-0">
            {item.subtitle && (
              <span className="text-xs text-muted-foreground truncate">
                {item.subtitle}
              </span>
            )}
            <span className="mr-auto font-semibold truncate">{item.title}</span>
          </div>
          <Button
            variant={"ghost"}
            {...attributes}
            {...listeners}
            className="p-1 text-secondary-foreground/50 -ml-2 h-auto cursor-grab"
          >
            <span className="sr-only">Move item</span>
            <LuGripVertical />
          </Button>
        </div>

        {showProgress &&
          ["PAUSED", "DONE", "IN_PROGRESS"].includes(item.status!) && (
            <Progress
              indicatorClassName={
                item.status === "PAUSED" ? "bg-yellow-500" : ""
              }
              leftLabel={
                item.progress ? formatDurationMilliseconds(item.progress) : ""
              }
              rightLabel={
                item.duration ? formatDurationMilliseconds(item.duration) : ""
              }
              value={
                item.progress && item.duration
                  ? (item.progress / item.duration) * 100
                  : 0
              }
            />
          )}
      </CardHeader>
      <CardContent className="p-3 space-y-2 text-left whitespace-pre-wrap text-sm">
        {showDescription && item.description && (
          <HStack className="justify-start space-x-2">
            <LuClipboardCheck className="text-muted-foreground" />
            <span className="text-sm">{item.description}</span>
          </HStack>
        )}
        {showStatus && item.status && (
          <HStack className="justify-start space-x-2">
            {getStatusIcon(item.status)}
            <span className="text-sm">{getStatusText(item.status)}</span>
          </HStack>
        )}
        {showDuration && item.duration && (
          <HStack className="justify-start space-x-2">
            <LuTimer className="text-muted-foreground" />
            <span className="text-sm">
              {formatDurationMilliseconds(item.duration)}
            </span>
          </HStack>
        )}
        {showDueDate && item.deadlineType && (
          <HStack className="justify-start space-x-2">
            {getDeadlineIcon(item.deadlineType, isOverdue)}
            <Tooltip>
              <TooltipTrigger>
                <span
                  className={cn("text-sm", isOverdue ? "text-red-500" : "")}
                >
                  {["ASAP", "NO_DEADLINE"].includes(item.deadlineType)
                    ? getDeadlineText(item.deadlineType)
                    : item.dueDate
                    ? `Due ${formatRelativeTime(
                        convertDateStringToIsoString(item.dueDate)
                      )}`
                    : "–"}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {getDeadlineText(item.deadlineType)}
              </TooltipContent>
            </Tooltip>
          </HStack>
        )}

        {showCustomer && item.customerId && (
          <HStack className="justify-start space-x-2">
            <LuFactory className="text-muted-foreground" />
            <CustomerAvatar customerId={item.customerId} />
          </HStack>
        )}

        {showEmployee && item.employeeIds && (
          <HStack className="justify-start space-x-2">
            <LuUsers className="text-muted-foreground" />
            <EmployeeAvatarGroup employeeIds={item.employeeIds} />
          </HStack>
        )}
      </CardContent>
    </Card>
  );
}

function getStatusIcon(status: Item["status"]) {
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

function getStatusText(status: Item["status"], overdue: boolean = false) {
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

function getDeadlineIcon(deadlineType: Item["deadlineType"], overdue: boolean) {
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

function getDeadlineText(deadlineType: Item["deadlineType"]) {
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
