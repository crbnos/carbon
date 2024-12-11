import {
  Card,
  CardContent,
  CardHeader,
  cn,
  HStack,
  Progress,
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDate,
  formatDurationMilliseconds,
  formatRelativeTime,
} from "@carbon/utils";
import { cva } from "class-variance-authority";
import {
  LuCalendarDays,
  LuCheckCircle,
  LuClipboardCheck,
  LuTimer,
  LuXCircle,
} from "react-icons/lu";

import { Link } from "@remix-run/react";
import { RiProgress8Line } from "react-icons/ri";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";

import { DeadlineIcon } from "~/components/Icons";
import { getPrivateUrl, path } from "~/utils/path";
import type { DisplaySettings, Item } from "../types";

type ItemCardProps = {
  item: Item;
} & DisplaySettings;

const cardVariants = cva(
  "dark:bg-gradient-to-tr dark:via-card dark:to-card dark:hover:to-muted/30 dark:hover:via-muted/30 bg-card hover:bg-muted/30",
  {
    variants: {
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
  showCustomer,
  showDescription,
  showDueDate,
  showDuration,
  showEmployee,
  showProgress,
  showStatus,
  showSalesOrder,
  showThumbnail,
}: ItemCardProps) {
  const isOverdue =
    item.deadlineType !== "No Deadline" && item.dueDate
      ? new Date(item.dueDate) < new Date()
      : false;

  return (
    <Link to={path.to.operation(item.id)}>
      <Card
        className={cn(
          "max-w-[330px]",
          cardVariants({
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
              <span>{item.title}</span>
            </div>
          </div>

          {showProgress &&
            ["Paused", "Done", "In Progress"].includes(item.status!) && (
              <Progress
                indicatorClassName={
                  item.status === "Paused" ? "bg-yellow-500" : ""
                }
                numerator={
                  item.progress ? formatDurationMilliseconds(item.progress) : ""
                }
                denominator={
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
          {showThumbnail && item.thumbnailPath && (
            <div className="flex justify-center">
              <img
                src={getPrivateUrl(item.thumbnailPath)}
                alt={item.title}
                className="w-full h-auto"
              />
            </div>
          )}
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
              <DeadlineIcon
                deadlineType={item.deadlineType}
                overdue={isOverdue}
              />

              <span className={cn("text-sm", isOverdue ? "text-red-500" : "")}>
                {["ASAP", "No Deadline"].includes(item.deadlineType)
                  ? item.deadlineType
                  : item.dueDate
                  ? `Due ${formatRelativeTime(
                      convertDateStringToIsoString(item.dueDate)
                    )}`
                  : "–"}
              </span>
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
                <span className="text-sm">{item.salesOrderReadableId}</span>
              </HStack>
            )}
        </CardContent>
      </Card>
    </Link>
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
