import {
  Badge,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  cn,
  Heading,
  HStack,
  Progress as ProgressComponent,
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
import { cva } from "class-variance-authority";
import {
  LuCalendarDays,
  LuCircleCheck,
  LuCircleX,
  LuClipboardCheck,
  LuHardHat,
  LuSquareUser,
  LuTimer,
  LuTrash,
} from "react-icons/lu";

import { Link } from "@remix-run/react";
import { FaTasks } from "react-icons/fa";
import { RiProgress8Line } from "react-icons/ri";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";

import { useRouteData } from "@carbon/remix";
import Avatar from "~/components/Avatar";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import { DeadlineIcon } from "~/components/Icons";
import { getPrivateUrl, path } from "~/utils/path";
import type { DisplaySettings, Item } from "../types";

interface Progress {
  totalDuration: number;
  progress: number;
  active: boolean;
  employees?: Set<string>;
}

type ItemCardProps = {
  item: Item;
  progressByItemId?: Record<string, Progress>;
} & DisplaySettings;

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

export function ItemCard({
  item,
  progressByItemId,
  showCustomer,
  showDescription,
  showDueDate,
  showDuration,
  showProgress,
  showStatus,
  showSalesOrder,
  showThumbnail,
}: ItemCardProps) {
  const routeData = useRouteData<{
    customers: { id: string; name: string }[];
  }>("/x/operations");

  const customer = showCustomer
    ? routeData?.customers.find((c) => c.id === item.customerId)
    : undefined;

  const isOverdue =
    item.deadlineType !== "No Deadline" && item.dueDate
      ? new Date(item.dueDate) < new Date()
      : false;

  const progress = progressByItemId?.[item.id]?.progress ?? item.progress ?? 0;
  const status = progressByItemId?.[item.id]?.active
    ? "In Progress"
    : item.status;
  const employeeIds = progressByItemId?.[item.id]?.employees
    ? Array.from(progressByItemId[item.id].employees!)
    : undefined;

  return (
    <Link to={path.to.operation(item.id)}>
      <Card
        className={cn(
          "max-w-[330px] shadow-sm dark:shadow-sm py-0",
          cardVariants({
            status: status,
          })
        )}
      >
        <CardHeader className="-mx-4 flex flex-col justify-between relative border-b py-3 px-4 rounded-t-lg gap-2">
          <div className="flex w-full max-w-full justify-between items-start gap-2">
            <div className="flex flex-col space-y-0 min-w-0">
              {item.itemReadableId && (
                <span className="text-xs text-muted-foreground line-clamp-1">
                  {item.itemReadableId}
                </span>
              )}
              <span className="mr-auto font-semibold line-clamp-2 leading-tight">
                {item.itemDescription || item.itemReadableId}
              </span>
            </div>
            <Heading size="h4" className="text-muted-foreground/70">
              {item.operationQuantity}
            </Heading>
          </div>

          {showProgress &&
            Number.isFinite(progress) &&
            Number.isFinite(item?.duration) &&
            Number(progress) >= 0 &&
            Number(item?.duration) > 0 && (
              <HStack className="mt-2">
                <ProgressComponent
                  indicatorClassName={
                    progress > (item.duration ?? 0)
                      ? "bg-red-500"
                      : status === "Paused"
                      ? "bg-yellow-500"
                      : ""
                  }
                  numerator={
                    progress ? formatDurationMilliseconds(progress) : ""
                  }
                  denominator={
                    item.duration
                      ? formatDurationMilliseconds(item.duration)
                      : ""
                  }
                  value={Math.min(
                    progress && item.duration
                      ? (progress / item.duration) * 100
                      : 0,
                    100
                  )}
                />
                <LuTimer className="text-muted-foreground w-4 h-4" />
              </HStack>
            )}
          {showProgress &&
            Number.isFinite(item.quantity) &&
            Number(item.quantity) > 0 && (
              <HStack className="mt-2">
                <ProgressComponent
                  numerator={(item.quantityCompleted ?? 0).toString()}
                  denominator={(item.quantity ?? 0).toString()}
                  value={
                    item.quantityCompleted && item.quantity
                      ? (item.quantityCompleted / item.quantity) * 100
                      : 0
                  }
                />
                <FaTasks className="text-muted-foreground w-4 h-4" />
              </HStack>
            )}
        </CardHeader>

        <CardContent className="pt-3 px-1 gap-2 text-left whitespace-pre-wrap text-sm">
          {showThumbnail && item.thumbnailPath && (
            <div className="flex justify-center">
              <img
                src={getPrivateUrl(item.thumbnailPath)}
                alt={item.title}
                className="w-full h-auto rounded-lg"
              />
            </div>
          )}
          <HStack className="justify-start space-x-2">
            <LuHardHat className="text-muted-foreground" />
            <span className="text-sm line-clamp-1">{item.title}</span>
          </HStack>

          {showDescription && item.description && (
            <HStack className="justify-start space-x-2">
              <LuClipboardCheck className="text-muted-foreground" />
              <span className="text-sm line-clamp-1">{item.description}</span>
            </HStack>
          )}
          {showStatus && status && (
            <HStack className="justify-start space-x-2">
              {getStatusIcon(status)}
              <span className="text-sm">{status}</span>
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
              <Tooltip>
                <TooltipTrigger>
                  <span
                    className={cn("text-sm", isOverdue ? "text-red-500" : "")}
                  >
                    {["ASAP", "No Deadline"].includes(item.deadlineType)
                      ? item.deadlineType
                      : item.dueDate
                      ? `Due ${formatRelativeTime(
                          convertDateStringToIsoString(item.dueDate)
                        )}`
                      : "–"}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {item.deadlineType}
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
                <span className="text-sm">{item.salesOrderReadableId}</span>
              </HStack>
            )}

          {Array.isArray(employeeIds) && employeeIds.length > 0 && (
            <HStack className="justify-start space-x-2">
              <Avatar size="xs" name="Active Employee" />
              <span className="text-sm">{employeeIds.length} Active</span>
            </HStack>
          )}

          {showCustomer && item.customerId && (
            <HStack className="justify-start space-x-2">
              <LuSquareUser className="text-muted-foreground" />
              <HStack className="truncate no-underline hover:no-underline">
                <Avatar size="xs" name={customer?.name ?? ""} />
                <span>{customer?.name}</span>
              </HStack>
            </HStack>
          )}

          {Number(item.quantityScrapped) > 0 && (
            <HStack className="justify-start space-x-2 text-red-500">
              <LuTrash className="w-4 h-4" />
              <span className="text-sm">{item.quantityScrapped} Scrapped</span>
            </HStack>
          )}
        </CardContent>
        {(item.assignee || (item.tags && item.tags.length > 0)) && (
          <CardFooter className="bg-accent/50 -mx-4 border-t px-4 py-2 items-center justify-start space-2 rounded-b-lg text-xs flex-wrap">
            {item.assignee && (
              <EmployeeAvatar size="xs" employeeId={item.assignee} />
            )}
            {item.tags?.map((tag) => (
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
      </Card>
    </Link>
  );
}

function getStatusIcon(status: Item["status"] | "In Progress") {
  switch (status) {
    case "Ready":
    case "Todo":
      return <TodoStatusIcon className="text-foreground" />;
    case "Waiting":
    case "Canceled":
      return <LuCircleX className="text-muted-foreground" />;
    case "Done":
      return <LuCircleCheck className="text-blue-600" />;
    case "In Progress":
      return <AlmostDoneIcon />;
    case "Paused":
      return <InProgressStatusIcon />;
    default:
      return null;
  }
}
