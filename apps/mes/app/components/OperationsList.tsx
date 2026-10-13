// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { convertDateStringToIsoString } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { cva } from "class-variance-authority";
import { LuCalendarDays, LuCirclePlay, LuClipboardCheck } from "react-icons/lu";
import { Link, useLocation } from "react-router";
import { DateTime } from "~/components";
import { useDateFormatter } from "~/hooks";
import type { Operation, OperationSettings } from "~/services/types";
import { withOrigin } from "~/utils/origin";
import { getPrivateUrl, path } from "~/utils/path";
import { DeadlineIcon, OperationStatusIcon } from "./Icons";
import {
  AssigneeTags,
  OperationDuration,
  PhoneThumbnail,
  QuantityStat
} from "./OperationCardParts";

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
  showThumbnail: true
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
        Todo: "border-border"
      }
    },
    defaultVariants: {
      status: "Todo"
    }
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
  showThumbnail
}: OperationCardProps) {
  const { t } = useLingui();
  const { formatRelativeTime } = useDateFormatter();
  const location = useLocation();
  const isOverdue =
    operation.jobDeadlineType !== "No Deadline" && operation.jobDueDate
      ? new Date(operation.jobDueDate) < new Date()
      : false;

  return (
    <Card
      className={cn(
        "h-full flex flex-col",
        cardVariants({
          status: operation.operationStatus
        })
      )}
    >
      <Link
        to={withOrigin(path.to.operation(operation.id), location)}
        className="flex flex-col flex-1"
      >
        <CardHeader className="flex flex-col justify-between relative gap-2 max-md:pb-1">
          <div className="flex w-full max-w-full justify-between items-start gap-2">
            {showThumbnail && operation.thumbnailPath && (
              <PhoneThumbnail
                path={operation.thumbnailPath}
                alt={operation.jobReadableId ?? ""}
              />
            )}
            <div className="flex flex-col space-y-0 min-w-0 max-md:flex-1">
              {operation.itemReadableId && (
                <span className="text-xs text-muted-foreground line-clamp-1">
                  {operation.itemReadableId}
                </span>
              )}
              <span className="mr-auto font-semibold line-clamp-2 leading-tight max-md:text-foreground">
                {operation.itemDescription || operation.itemReadableId}
              </span>
            </div>
            <QuantityStat className="text-muted-foreground/70 max-md:text-foreground max-md:tabular-nums">
              {operation.targetQuantity ?? operation.operationQuantity ?? 0}
            </QuantityStat>
          </div>
        </CardHeader>
        <CardContent className="gap-2 text-left whitespace-pre-wrap text-sm max-md:border-t-0 max-md:pt-1 flex-grow max-md:grid max-md:grid-cols-2 max-md:content-start max-md:gap-x-3 max-md:gap-y-1.5 max-md:[&>*]:min-w-0">
          {showThumbnail && operation.thumbnailPath && (
            <div className="flex justify-center max-md:hidden">
              <img
                src={getPrivateUrl(operation.thumbnailPath)}
                alt={operation.jobReadableId}
                className="w-full h-auto rounded-lg"
              />
            </div>
          )}
          <HStack className="justify-start space-x-2 max-md:col-span-2">
            <LuCirclePlay className="text-muted-foreground" />
            <span className="text-sm line-clamp-1">
              {operation.jobReadableId}
            </span>
          </HStack>

          {showDescription && operation.description && (
            <HStack className="justify-start space-x-2 max-md:col-span-2">
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
            <OperationDuration value={operation.duration} />
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
                          ? t`Due ${formatRelativeTime(
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
                    <DateTime value={operation.jobDueDate} variant="date" />
                  </span>
                </HStack>
              )}
            </>
          )}
          {(operation.assignee ||
            (operation.tags && operation.tags.length > 0)) && (
            <div className="hidden flex-wrap items-center gap-1 text-xs max-md:col-span-2 max-md:flex">
              <AssigneeTags
                assignee={operation.assignee}
                tags={operation.tags}
              />
            </div>
          )}
        </CardContent>
        {(operation.assignee ||
          (operation.tags && operation.tags.length > 0)) && (
          <CardFooter className="items-center justify-start text-xs flex-wrap mt-auto max-md:hidden">
            <AssigneeTags assignee={operation.assignee} tags={operation.tags} />
          </CardFooter>
        )}
      </Link>
    </Card>
  );
}
