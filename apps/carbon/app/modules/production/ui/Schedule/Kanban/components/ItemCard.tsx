import {
  Card,
  CardContent,
  CardHeader,
  cn,
  HStack,
  IconButton,
  Progress,
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
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cva } from "class-variance-authority";
import {
  LuCalendarDays,
  LuCheckCircle,
  LuClipboardCheck,
  LuExternalLink,
  LuGripVertical,
  LuTimer,
  LuUsers,
  LuUserSquare,
  LuXCircle,
} from "react-icons/lu";

import { Link } from "@remix-run/react";
import { RiProgress8Line } from "react-icons/ri";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import { CustomerAvatar, EmployeeAvatarGroup } from "~/components";

import { path } from "~/utils/path";
import { getDeadlineIcon, getDeadlineText } from "../../../Jobs/Deadline";
import type { DisplaySettings, Item, ItemDragData } from "../types";

type ItemCardProps = {
  item: Item;
  isOverlay?: boolean;
} & DisplaySettings;

const cardVariants = cva(
  "dark:bg-gradient-to-tr dark:via-card dark:to-card dark:hover:to-muted/30 dark:hover:via-muted/30 bg-card hover:bg-muted/30",
  {
    variants: {
      dragging: {
        over: "ring-2 ring-primary opacity-30",
        overlay:
          "ring-2 ring-primary dark:hover:from-muted dark:hover:via-muted dark:hover:to-muted hover:bg-muted",
      },
      status: {
        "In Progress":
          "border-emerald-600/30 dark:from-emerald-600/10 bg-emerald-600/5",
        Ready: "",
        Done: "",
        Paused: "border-yellow-500/30 dark:from-yellow-500/10 bg-yellow-500/5",
        Canceled: "border-red-500/30 dark:from-red-500/10 bg-red-500/5",
        Waiting: "border-yellow-500/30 dark:from-yellow-500/10 bg-yellow-500/5",
        Todo: "border-border",
      },
    },
    defaultVariants: {
      status: "Todo",
    },
  }
);

const cardHeaderVariants = cva("border-b", {
  variants: {
    status: {
      "In Progress": "border-emerald-600/10",
      Ready: "",
      Done: "",
      Paused: "border-yellow-500/10",
      Canceled: "border-red-500/10",
      Waiting: "border-yellow-500/10",
      Todo: "border-border",
    },
  },
  defaultVariants: {
    status: "Todo",
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
  showSalesOrder,
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
    item.deadlineType !== "No Deadline" && item.dueDate
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
              <span className="text-xs text-muted-foreground line-clamp-1">
                {item.subtitle}
              </span>
            )}
            <Link
              to={`${item.link}?selectedOperation=${item.id}`}
              className="mr-auto font-semibold line-clamp-1"
            >
              {item.title}
            </Link>
          </div>
          <HStack spacing={0} className="-mr-4">
            <IconButton
              aria-label="Move item"
              icon={<LuGripVertical />}
              variant={"ghost"}
              {...attributes}
              {...listeners}
              className="cursor-grab"
            />
            {item.link && (
              <Link to={`${item.link}?selectedOperation=${item.id}`}>
                <IconButton
                  aria-label="Link to job operation"
                  icon={<LuExternalLink />}
                  variant={"ghost"}
                  className="cursor-grab"
                />
              </Link>
            )}
          </HStack>
        </div>

        {showProgress &&
          Number.isFinite(item?.progress) &&
          Number.isFinite(item?.duration) &&
          Number(item?.progress) >= 0 &&
          Number(item?.duration) >= 0 && (
            <Progress
              indicatorClassName={
                (item.progress ?? 0) > (item.duration ?? 0)
                  ? "bg-destructive"
                  : item.status === "Paused"
                  ? "bg-yellow-500"
                  : ""
              }
              numerator={
                item.progress ? formatDurationMilliseconds(item.progress) : ""
              }
              denominator={
                item.duration ? formatDurationMilliseconds(item.duration) : ""
              }
              value={Math.min(
                item.progress && item.duration
                  ? (item.progress / item.duration) * 100
                  : 0,
                100
              )}
            />
          )}
      </CardHeader>
      <CardContent className="p-3 space-y-2 text-left whitespace-pre-wrap text-sm">
        {showDescription && item.description && (
          <HStack className="justify-start space-x-2">
            <LuClipboardCheck className="text-muted-foreground" />
            <span className="text-sm line-clamp-1">{item.description}</span>
          </HStack>
        )}
        {showStatus && item.status && (
          <HStack className="justify-start space-x-2">
            {getStatusIcon(item.status)}
            <span className="text-sm">{item.status}</span>
          </HStack>
        )}
        {showDuration && typeof item.duration === "number" && (
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
                  {["ASAP", "No Deadline"].includes(item.deadlineType)
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
        {showDueDate && item.dueDate && (
          <HStack className="justify-start space-x-2">
            <LuCalendarDays />
            <span className="text-sm">{formatDate(item.dueDate)}</span>
          </HStack>
        )}

        {showSalesOrder &&
          item.salesOrderReadableId &&
          item.salesOrderId &&
          item.salesOrderLineId && (
            <HStack className="justify-start space-x-2">
              <RiProgress8Line className="text-muted-foreground" />
              <Link
                to={path.to.salesOrderLine(
                  item.salesOrderId,
                  item.salesOrderLineId
                )}
                className="text-sm"
              >
                {item.salesOrderReadableId}
              </Link>
            </HStack>
          )}

        {showCustomer && item.customerId && (
          <HStack className="justify-start space-x-2">
            <LuUserSquare className="text-muted-foreground" />
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
