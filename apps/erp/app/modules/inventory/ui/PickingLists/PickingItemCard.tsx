import {
  BarProgress,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDurationMilliseconds
} from "@carbon/utils";
import { cva } from "class-variance-authority";
import {
  LuCirclePlay,
  LuClipboardCheck,
  LuPackage,
  LuSquareUser,
  LuTimer,
  LuTrash
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Link } from "react-router";
import { CustomerAvatar } from "~/components";
import { useDateFormatter } from "~/hooks";
import { getDeadlineIcon } from "~/modules/production/ui/Jobs/Deadline";
import { JobOperationStatus } from "~/modules/production/ui/Jobs/JobOperationStatus";
import { getPrivateUrl, path } from "~/utils/path";

export type PickingDisplaySettings = {
  showCustomer: boolean;
  showDescription: boolean;
  showDueDate: boolean;
  showDuration: boolean;
  showProgress: boolean;
  showQuantity: boolean;
  showStatus: boolean;
  showSalesOrder: boolean;
  showThumbnail: boolean;
};

export const defaultPickingDisplaySettings: PickingDisplaySettings = {
  showCustomer: true,
  showDescription: true,
  showDueDate: true,
  showDuration: false,
  showProgress: false,
  showQuantity: true,
  showStatus: true,
  showSalesOrder: true,
  showThumbnail: false
};

export type PickingScheduleItem = {
  jobOperationId: string;
  jobId: string;
  jobMakeMethodId: string | null;
  jobReadableId: string;
  itemId: string | null;
  itemReadableId: string | null;
  itemDescription: string | null;
  operationOrder: number;
  operationDescription: string | null;
  processName: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
  operationStatus: string | null;
  deadlineType: string | null;
  dueDate: string | null;
  customerId: string | null;
  customerName: string | null;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  salesOrderReadableId: string | null;
  thumbnailPath: string | null;
  targetQuantity: number | null;
  operationQuantity: number | null;
  quantityComplete: number | null;
  quantityReworked: number | null;
  quantityScrapped: number | null;
  duration: number;
  partsToPickCount: number;
  totalQuantityToPick: number;
};

const cardVariants = cva(
  "bg-card hover:bg-muted/30 cursor-pointer transition-[background-color,box-shadow] duration-150 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]",
  {
    variants: {
      selected: {
        true: "ring-2 ring-primary",
        false: ""
      },
      status: {
        "In Progress": "border-emerald-600/30",
        Ready: "",
        Done: "",
        Paused: "opacity-70",
        Canceled: "border-red-500/30",
        Cancelled: "border-red-500/30",
        Waiting: "opacity-50",
        Todo: "border-border"
      }
    },
    defaultVariants: {
      status: "Todo"
    }
  }
);

type PickingItemCardProps = {
  item: PickingScheduleItem;
  isSelected: boolean;
  onToggle: (id: string) => void;
  displaySettings: PickingDisplaySettings;
};

export function PickingItemCard({
  item,
  isSelected,
  onToggle,
  displaySettings
}: PickingItemCardProps) {
  const { formatDate, formatRelativeTime } = useDateFormatter();

  const isOverdue =
    item.deadlineType && item.deadlineType !== "No Deadline" && item.dueDate
      ? new Date(item.dueDate) < new Date()
      : false;

  const status = item.operationStatus ?? "Todo";

  return (
    <Card
      onClick={() => onToggle(item.jobOperationId)}
      className={cn(
        "max-w-[330px]",
        cardVariants({
          // @ts-expect-error status is a string union at runtime
          status,
          selected: isSelected
        })
      )}
    >
      <CardHeader className="flex flex-col justify-between relative gap-2">
        <div className="flex w-full max-w-full justify-between items-start gap-2">
          <div className="flex flex-col space-y-0 min-w-0">
            {item.itemReadableId && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {item.itemReadableId}
              </span>
            )}
            <Link
              to={
                item.jobMakeMethodId
                  ? path.to.jobMethod(item.jobId, item.jobMakeMethodId)
                  : path.to.job(item.jobId)
              }
              onClick={(e) => e.stopPropagation()}
              className="mr-auto font-semibold line-clamp-2 leading-tight"
            >
              {item.itemDescription || item.itemReadableId}
            </Link>
          </div>
          <Checkbox
            isChecked={isSelected}
            onCheckedChange={() => onToggle(item.jobOperationId)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${item.jobReadableId}`}
            className="mt-0.5 flex-shrink-0"
          />
        </div>

        {displaySettings.showProgress &&
          Number(item.targetQuantity ?? item.operationQuantity) > 0 && (
            <HStack>
              <BarProgress
                segments={[
                  {
                    value: item.quantityComplete ?? 0,
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
                max={(item.targetQuantity ?? item.operationQuantity) || 1}
                progress={
                  item.quantityComplete &&
                  (item.targetQuantity ?? item.operationQuantity)
                    ? (item.quantityComplete /
                        (item.targetQuantity ?? item.operationQuantity ?? 1)) *
                      100
                    : 0
                }
              />
            </HStack>
          )}
      </CardHeader>
      <CardContent className="gap-2 text-left whitespace-pre-wrap text-sm">
        {displaySettings.showThumbnail && item.thumbnailPath && (
          <div className="flex justify-center">
            <img
              src={getPrivateUrl(item.thumbnailPath)}
              alt={item.itemDescription ?? ""}
              className="w-full h-auto rounded-lg"
            />
          </div>
        )}

        <HStack className="justify-start space-x-2">
          <LuCirclePlay className="text-muted-foreground shrink-0" />
          <span className="text-sm line-clamp-1">{item.jobReadableId}</span>
        </HStack>

        {/* Parts to pick — the reason this operation is on the picking schedule */}
        <HStack className="justify-start space-x-2 font-medium">
          <LuPackage className="text-muted-foreground shrink-0" />
          <span className="text-sm tabular-nums">
            {Number(item.partsToPickCount).toLocaleString()}{" "}
            {Number(item.partsToPickCount) === 1 ? "part" : "parts"} ·{" "}
            {Number(item.totalQuantityToPick).toLocaleString()} to pick
          </span>
        </HStack>

        {displaySettings.showDescription && item.operationDescription && (
          <HStack className="justify-start space-x-2">
            <LuClipboardCheck className="text-muted-foreground shrink-0" />
            <span className="text-sm line-clamp-1">
              {item.operationDescription}
            </span>
          </HStack>
        )}

        {displaySettings.showStatus && status && (
          <HStack className="justify-start space-x-1.5">
            <JobOperationStatus
              operation={{
                id: item.jobOperationId,
                // @ts-expect-error status is a string union at runtime
                status,
                jobId: item.jobId
              }}
              className="size-4 p-0 hover:bg-transparent"
            />
            <span className="text-sm">{status}</span>
          </HStack>
        )}

        {displaySettings.showDuration && item.duration > 0 && (
          <HStack className="justify-start space-x-2">
            <LuTimer className="text-muted-foreground shrink-0" />
            <span className="text-sm tabular-nums">
              {formatDurationMilliseconds(item.duration)}
            </span>
          </HStack>
        )}

        {displaySettings.showDueDate && item.dueDate && (
          <HStack className="justify-start space-x-2">
            {item.deadlineType &&
              getDeadlineIcon(
                item.deadlineType as Parameters<typeof getDeadlineIcon>[0]
              )}
            <Tooltip>
              <TooltipTrigger>
                <span
                  className={cn(
                    "text-sm tabular-nums",
                    isOverdue ? "text-red-500" : ""
                  )}
                >
                  Due{" "}
                  {formatRelativeTime(
                    convertDateStringToIsoString(item.dueDate)
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {formatDate(item.dueDate)}
              </TooltipContent>
            </Tooltip>
          </HStack>
        )}

        {displaySettings.showSalesOrder &&
          item.salesOrderReadableId &&
          item.salesOrderId &&
          item.salesOrderLineId && (
            <HStack className="justify-start space-x-2">
              <RiProgress8Line className="text-muted-foreground shrink-0" />
              <Link
                to={path.to.salesOrderLine(
                  item.salesOrderId,
                  item.salesOrderLineId
                )}
                onClick={(e) => e.stopPropagation()}
                className="text-sm"
              >
                {item.salesOrderReadableId}
              </Link>
            </HStack>
          )}

        {displaySettings.showCustomer && item.customerId && (
          <HStack className="justify-start space-x-2">
            <LuSquareUser className="text-muted-foreground shrink-0" />
            <CustomerAvatar customerId={item.customerId} />
          </HStack>
        )}

        {displaySettings.showQuantity && Number(item.quantityScrapped) > 0 && (
          <HStack className="justify-start space-x-2 text-red-500">
            <LuTrash className="size-4 shrink-0" />
            <span className="text-sm tabular-nums">
              {item.quantityScrapped} Scrapped
            </span>
          </HStack>
        )}
      </CardContent>
    </Card>
  );
}
