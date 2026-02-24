import { ValidatedForm } from "@carbon/form";
import {
  BarProgress,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import {
  convertDateStringToIsoString,
  formatDate,
  formatDurationMilliseconds,
  formatRelativeTime
} from "@carbon/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cva } from "class-variance-authority";
import {
  LuCalendarDays,
  LuCircleCheck,
  LuCirclePlay,
  LuClipboardCheck,
  LuEllipsisVertical,
  LuFlashlight,
  LuFlashlightOff,
  LuGripVertical,
  LuPencil,
  LuPlay,
  LuSquareUser,
  LuTimer,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Link } from "react-router";
import { z } from "zod";
import { Assignee, CustomerAvatar, EmployeeAvatarGroup } from "~/components";
import { Tags } from "~/components/Form";
import { useTags } from "~/hooks/useTags";
import { getDeadlineIcon } from "~/modules/production/ui/Jobs/Deadline";
import { JobOperationStatus } from "~/modules/production/ui/Jobs/JobOperationStatus";
import { getPrivateUrl, path } from "~/utils/path";
import { useKanban } from "../context/KanbanContext";
import type { Item } from "../types";

interface Progress {
  totalDuration: number;
  progress: number;
  active: boolean;
  employees?: Set<string>;
}

const cardVariants = cva(
  "bg-card hover:bg-muted/30 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]",
  {
    variants: {
      highlighted: {
        true: "ring-2 ring-primary opacity-100",
        false: ""
      },
      dragging: {
        over: "ring-2 ring-primary opacity-30",
        overlay: "ring-2 ring-primary hover:bg-muted"
      },
      status: {
        "In Progress": "border-emerald-600/30",
        Ready: "",
        Done: "",
        Paused: "",
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

type ItemCardProps = {
  item: Item;
  isOverlay?: boolean;
  progressByItemId: Record<string, Progress>;
};

export function ItemCard({ item, isOverlay, progressByItemId }: ItemCardProps) {
  const { displaySettings, selectedGroup, setSelectedGroup, tags } =
    useKanban();
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: item.id,
    data: {
      type: "item",
      item
    },
    attributes: {
      roleDescription: "item"
    }
  });

  const isHighlighted = selectedGroup === item.jobReadableId;

  const style = {
    transition,
    transform: CSS.Translate.toString(transform)
  };

  const isOverdue =
    item.deadlineType !== "No Deadline" && item.dueDate
      ? new Date(item.dueDate) < new Date()
      : false;

  const progress = progressByItemId[item.id]?.progress ?? 0;
  const status = progressByItemId[item.id]?.active
    ? "In Progress"
    : item.status;
  const employeeIds = progressByItemId[item.id]?.employees
    ? Array.from(progressByItemId[item.id].employees!)
    : undefined;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "max-w-[330px]",
        cardVariants({
          dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
          status: status,
          highlighted: isHighlighted
        })
      )}
    >
      <CardHeader className="flex flex-col justify-between relative gap-2">
        <div className="flex w-full max-w-full justify-between items-start gap-0">
          <div className="flex flex-col space-y-0 min-w-0">
            {item.itemReadableId && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {item.itemReadableId}
              </span>
            )}
            <Link
              to={`${item.link}?selectedOperation=${item.id}`}
              className="mr-auto font-semibold line-clamp-2 leading-tight"
            >
              {item.itemDescription || item.itemReadableId}
            </Link>
          </div>
          <HStack spacing={1} className="flex-shrink-0 -mr-2">
            <IconButton
              aria-label="Move item"
              icon={<LuGripVertical />}
              variant={"ghost"}
              {...attributes}
              {...listeners}
              className="cursor-grab"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More options"
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {item.link && (
                  <DropdownMenuItem asChild>
                    <Link to={`${item.link}?selectedOperation=${item.id}`}>
                      <DropdownMenuIcon icon={<LuPencil />} />
                      Edit Operation
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() =>
                    setSelectedGroup?.(
                      isHighlighted ? null : item.jobReadableId
                    )
                  }
                  destructive={isHighlighted}
                >
                  <DropdownMenuIcon
                    icon={
                      isHighlighted ? <LuFlashlightOff /> : <LuFlashlight />
                    }
                  />
                  {isHighlighted ? "Remove Highlight" : "Highlight Job"}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={path.to.external.mesJobOperation(item.id)}>
                    <DropdownMenuIcon icon={<LuPlay />} />
                    Open in MES
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </div>

        {displaySettings.showProgress &&
          Number.isFinite(progress) &&
          Number.isFinite(item?.duration) &&
          Number(progress) >= 0 &&
          Number(item?.duration) >= 0 && (
            <HStack>
              <BarProgress
                gradient
                invertGradient
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
        {displaySettings.showProgress &&
          Number.isFinite(item.targetQuantity ?? item.quantity) &&
          Number(item.targetQuantity ?? item.quantity) > 0 && (
            <HStack>
              <BarProgress
                progress={
                  item.quantityCompleted &&
                  (item.targetQuantity ?? item.quantity)
                    ? (item.quantityCompleted /
                        (item.targetQuantity ?? item.quantity)) *
                      100
                    : 0
                }
              />
              <LuCircleCheck className="text-muted-foreground w-4 h-4" />
            </HStack>
          )}
      </CardHeader>
      <CardContent className="gap-2 text-left whitespace-pre-wrap text-sm">
        {displaySettings.showThumbnail && item.thumbnailPath && (
          <div className="flex justify-center">
            <img
              src={getPrivateUrl(item.thumbnailPath)}
              alt={item.itemDescription}
              className="w-full h-auto rounded-lg"
            />
          </div>
        )}
        <HStack className="justify-start space-x-2">
          <LuCirclePlay className="text-muted-foreground" />
          <span className="text-sm line-clamp-1">{item.title}</span>
        </HStack>
        {displaySettings.showDescription && item.description && (
          <HStack className="justify-start space-x-2">
            <LuClipboardCheck className="text-muted-foreground" />
            <span className="text-sm line-clamp-1">{item.description}</span>
          </HStack>
        )}
        {displaySettings.showStatus && status && (
          <HStack className="justify-start space-x-1.5">
            <JobOperationStatus
              operation={{
                id: item.id,
                status: status ?? "Todo",
                jobId: item.jobId
              }}
              className="size-4 p-0 hover:bg-transparent"
            />
            <span className="text-sm">{status}</span>
          </HStack>
        )}
        {displaySettings.showDuration && typeof item.duration === "number" && (
          <HStack className="justify-start space-x-2">
            <LuTimer className="text-muted-foreground" />
            <span className="text-sm">
              {formatDurationMilliseconds(item.duration)}
            </span>
          </HStack>
        )}
        {displaySettings.showDueDate && item.deadlineType && (
          <HStack className="justify-start space-x-2">
            {getDeadlineIcon(item.deadlineType)}
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
              <TooltipContent side="right">{item.deadlineType}</TooltipContent>
            </Tooltip>
          </HStack>
        )}
        {displaySettings.showDueDate && item.dueDate && (
          <HStack className="justify-start space-x-2">
            <LuCalendarDays />
            <span className="text-sm">{formatDate(item.dueDate)}</span>
          </HStack>
        )}

        {displaySettings.showSalesOrder &&
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

        {displaySettings.showCustomer && item.customerId && (
          <HStack className="justify-start space-x-2">
            <LuSquareUser className="text-muted-foreground" />
            <CustomerAvatar customerId={item.customerId} />
          </HStack>
        )}

        {displaySettings.showEmployee &&
          Array.isArray(employeeIds) &&
          employeeIds.length > 0 && (
            <HStack className="justify-start space-x-2">
              <LuUsers className="text-muted-foreground" />
              <EmployeeAvatarGroup employeeIds={employeeIds} />
            </HStack>
          )}

        {displaySettings.showQuantity && Number(item.quantityScrapped) > 0 && (
          <HStack className="justify-start space-x-2 text-red-500">
            <LuTrash className="w-4 h-4" />
            <span className="text-sm">{item.quantityScrapped} Scrapped</span>
          </HStack>
        )}
      </CardContent>
      <CardFooter className="items-center justify-between text-xs flex-wrap">
        <HStack>
          <Assignee
            table="jobOperation"
            id={item.id!}
            size="sm"
            value={item.assignee ?? undefined}
          />
          <JobOperationTags operation={item} availableTags={tags} />
        </HStack>
      </CardFooter>
    </Card>
  );
}

function JobOperationTags({
  operation,
  availableTags
}: {
  operation: Item;
  availableTags: { name: string }[];
}) {
  const { onUpdateTags } = useTags({ id: operation.id, table: "jobOperation" });

  return (
    <ValidatedForm
      defaultValues={{
        tags: operation.tags ?? []
      }}
      validator={z.object({
        tags: z.array(z.string()).optional()
      })}
      className="w-full"
    >
      <Tags
        availableTags={availableTags}
        label=""
        name="tags"
        table="operation"
        inline
        maxPreview={1}
        onChange={onUpdateTags}
      />
    </ValidatedForm>
  );
}
