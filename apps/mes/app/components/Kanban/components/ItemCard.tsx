// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  BarProgress,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useRouteData
} from "@carbon/react";
import { convertDateStringToIsoString } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { cva } from "class-variance-authority";
import {
  LuCalendarDays,
  LuCircleCheck,
  LuCirclePlay,
  LuClipboardCheck,
  LuSquareUser,
  LuTimer,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Link, useLocation } from "react-router";
import { DateTime, OperationStatusIcon } from "~/components";
import Avatar from "~/components/Avatar";
import { DeadlineIcon } from "~/components/Icons";
import {
  AssigneeTags,
  OperationDuration,
  PhoneThumbnail,
  QuantityStat
} from "~/components/OperationCardParts";
import { useDateFormatter } from "~/hooks";
import { withOrigin } from "~/utils/origin";
import { getPrivateUrl, path } from "~/utils/path";
import { DUE_URGENCY_BORDER, getDueUrgency } from "../dueUrgency";
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
        Todo: "border-border"
      }
    },
    defaultVariants: {
      status: "Todo"
    }
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
  showThumbnail
}: ItemCardProps) {
  const { t } = useLingui();
  const { formatRelativeTime } = useDateFormatter();
  const routeData = useRouteData<{
    customers: { id: string; name: string }[];
    today: string | null;
  }>("/x/operations");
  // The factory's calendar day from the loader (location time zone); the
  // device's own day only when there is no location.
  const scheduleToday =
    routeData?.today ?? today(getLocalTimeZone()).toString();

  const customer = showCustomer
    ? routeData?.customers.find((c) => c.id === item.customerId)
    : undefined;

  const isOverdue =
    item.deadlineType !== "ASAP" &&
    item.deadlineType !== "No Deadline" &&
    !!item.dueDate &&
    item.dueDate < scheduleToday;

  const progress = progressByItemId?.[item.id]?.progress ?? item.progress ?? 0;
  const status = progressByItemId?.[item.id]?.active
    ? "In Progress"
    : item.status;
  const employeeIds = progressByItemId?.[item.id]?.employees
    ? Array.from(progressByItemId[item.id].employees!)
    : undefined;

  const location = useLocation();
  const isBatch = (item.batchSize ?? 0) > 1 && !!item.batchId;
  const urgency = getDueUrgency({ ...item, status }, scheduleToday);

  return (
    <Link
      to={withOrigin(
        isBatch ? path.to.batch(item.batchId!) : path.to.operation(item.id),
        location
      )}
    >
      <Card
        className={cn(
          "max-w-[330px] max-md:max-w-none",
          cardVariants({
            status: status
          }),
          urgency && DUE_URGENCY_BORDER[urgency]
        )}
      >
        <CardHeader className="flex flex-col justify-between relative gap-2 max-md:pb-1">
          <div className="flex w-full max-w-full justify-between items-start gap-2">
            {showThumbnail && item.thumbnailPath && (
              <PhoneThumbnail path={item.thumbnailPath} alt={item.title} />
            )}
            <div className="flex flex-col space-y-0 min-w-0 max-md:flex-1">
              {item.itemReadableId && (
                <span className="text-xs text-muted-foreground line-clamp-1">
                  {isBatch ? item.batchReadableId : item.itemReadableId}
                </span>
              )}
              <span className="mr-auto font-semibold line-clamp-2 leading-tight text-foreground">
                {isBatch
                  ? `${item.batchSize} jobs batched`
                  : item.itemDescription || item.itemReadableId}
              </span>
            </div>
            <HStack spacing={2} className="flex-shrink-0">
              {item.hasConflict && (
                <Tooltip>
                  <TooltipTrigger>
                    <LuTriangleAlert className="h-4 w-4 text-red-500 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent className="whitespace-pre-line">
                    {item.conflictReason ?? t`Scheduling conflict`}
                  </TooltipContent>
                </Tooltip>
              )}
              <QuantityStat className="text-foreground">
                {isBatch
                  ? `×${item.batchSize} · ${item.targetQuantity}`
                  : item.targetQuantity}
              </QuantityStat>
            </HStack>
          </div>

          <div className="contents max-md:grid max-md:grid-cols-2 max-md:gap-3 max-md:[&>*:only-child]:col-span-2">
            {showProgress &&
              Number.isFinite(progress) &&
              Number.isFinite(item?.duration) &&
              Number(progress) >= 0 &&
              Number(item?.duration) > 0 && (
                <HStack className="mt-2">
                  <BarProgress
                    gradient
                    invertGradient
                    activeClassName={
                      progress > (item.duration ?? 0)
                        ? "bg-red-500"
                        : status === "Paused"
                          ? "bg-yellow-500"
                          : "bg-emerald-500"
                    }
                    progress={Math.min(
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
                  <BarProgress
                    segments={[
                      {
                        value: item.quantityCompleted ?? 0,
                        className: "bg-emerald-500"
                      },
                      {
                        value: item.quantityReworked ?? 0,
                        className: "bg-yellow-500"
                      },
                      {
                        value: item.quantityScrapped ?? 0,
                        className: "bg-red-500"
                      }
                    ]}
                    max={item.targetQuantity || 1}
                    progress={
                      item.quantityCompleted && item.targetQuantity
                        ? (item.quantityCompleted / item.targetQuantity) * 100
                        : 0
                    }
                  />
                  <LuCircleCheck className="text-muted-foreground w-4 h-4" />
                </HStack>
              )}
          </div>
        </CardHeader>

        <CardContent className="gap-2 text-left whitespace-pre-wrap text-sm max-md:border-t-0 max-md:pt-1 max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-1.5 max-md:[&>*]:min-w-0">
          {showThumbnail && item.thumbnailPath && (
            <div className="flex justify-center max-md:hidden">
              <img
                src={getPrivateUrl(item.thumbnailPath)}
                alt={item.title}
                className="w-full h-auto rounded-lg"
              />
            </div>
          )}
          <HStack className="justify-start space-x-2 max-md:col-span-2">
            <LuCirclePlay className="text-muted-foreground" />
            <span className="text-sm line-clamp-1">
              {isBatch && item.batchJobReadableIds?.length
                ? item.batchJobReadableIds.join(", ")
                : item.title}
            </span>
            {item.reworkId && <Badge variant="red">Rework</Badge>}
          </HStack>

          {showDescription && item.description && (
            <HStack className="justify-start space-x-2 max-md:col-span-2">
              <LuClipboardCheck className="text-muted-foreground" />
              <span className="text-sm line-clamp-1">{item.description}</span>
            </HStack>
          )}
          {showStatus && status && (
            <HStack className="justify-start space-x-2">
              <OperationStatusIcon status={status} />
              <span className="text-sm">{status}</span>
            </HStack>
          )}
          {showDuration && typeof item.duration === "number" && (
            <OperationDuration value={item.duration} />
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
                        ? t`Due ${formatRelativeTime(
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
              <span className="text-sm">
                <DateTime value={item.dueDate} variant="date" />
              </span>
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
            <HStack className="justify-start space-x-2 max-md:order-1">
              <Avatar size="xs" name="Active Employee" />
              <span className="text-sm">
                <Trans>{employeeIds.length} Active</Trans>
              </span>
            </HStack>
          )}

          {showCustomer && item.customerId && (
            <HStack className="justify-start space-x-2 min-w-0">
              <LuSquareUser className="text-muted-foreground shrink-0" />
              <HStack className="min-w-0 truncate no-underline hover:no-underline">
                <Avatar size="xs" name={customer?.name ?? ""} />
                <span className="truncate">{customer?.name}</span>
              </HStack>
            </HStack>
          )}

          {Number(item.quantityScrapped) > 0 && (
            <HStack className="justify-start space-x-2 text-red-500 max-md:order-1">
              <LuTrash className="w-4 h-4" />
              <span className="text-sm">
                <Trans>{item.quantityScrapped} Scrapped</Trans>
              </span>
            </HStack>
          )}
          {(item.assignee || (item.tags && item.tags.length > 0)) && (
            <div className="hidden flex-wrap items-center gap-1 text-xs max-md:order-2 max-md:col-span-2 max-md:flex">
              <AssigneeTags assignee={item.assignee} tags={item.tags} />
            </div>
          )}
        </CardContent>
        {(item.assignee || (item.tags && item.tags.length > 0)) && (
          <CardFooter className="items-center justify-start space-2 text-xs flex-wrap max-md:hidden">
            <AssigneeTags assignee={item.assignee} tags={item.tags} />
          </CardFooter>
        )}
      </Card>
    </Link>
  );
}
