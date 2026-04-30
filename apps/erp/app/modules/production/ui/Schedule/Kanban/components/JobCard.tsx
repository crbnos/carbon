import {
  BarProgress,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  cn,
  DatePicker as DatePickerInput,
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
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { cva } from "class-variance-authority";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuCalendarDays,
  LuCircleCheck,
  LuClock,
  LuEllipsisVertical,
  LuFlashlight,
  LuFlashlightOff,
  LuGripVertical,
  LuPencil,
  LuStar,
  LuTriangleAlert,
  LuUsers
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Link, useSubmit } from "react-router";
import { Assignee, EmployeeAvatarGroup } from "~/components";
import { useDateFormatter } from "~/hooks";
import { getDeadlineIcon } from "~/modules/production/ui/Jobs/Deadline";
import { useCustomers } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import JobStatus from "../../../Jobs/JobStatus";
import { useKanban } from "../context/KanbanContext";
import type { JobItem } from "../types";

interface Progress {
  totalDuration: number;
  progress: number;
  active: boolean;
  employees?: Set<string>;
}

const DATE_COLUMN_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getDateOnly(value?: string | null) {
  return value?.split("T")[0] ?? null;
}

function getOptimisticColumnId(dueDate: string, columnIds: string[]) {
  if (columnIds.includes(dueDate)) {
    return dueDate;
  }

  if (columnIds.includes("next-week")) {
    return "next-week";
  }

  if (columnIds.includes("next-month")) {
    const selectedDate = parseDate(dueDate);
    const dateColumns = columnIds
      .filter((id) => DATE_COLUMN_PATTERN.test(id))
      .sort();

    for (const columnId of dateColumns) {
      const weekStart = parseDate(columnId);
      const weekEnd = weekStart.add({ days: 6 });

      if (
        selectedDate.compare(weekStart) >= 0 &&
        selectedDate.compare(weekEnd) <= 0
      ) {
        return columnId;
      }
    }

    return "next-month";
  }

  return dueDate;
}

function getEmptyDueDateColumnId(
  columnIds: string[],
  fallbackColumnId: string
) {
  if (columnIds.includes("next-week")) {
    return "next-week";
  }

  if (columnIds.includes("next-month")) {
    return "next-month";
  }

  return fallbackColumnId;
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
        Draft: "border-border",
        Planned: "border-yellow-500/30",
        Ready: "border-blue-500/30",
        "In Progress": "border-emerald-600/30",
        Paused: "border-orange-500/30",
        Completed: "border-green-500/30",
        Cancelled: "border-red-500/30",
        Overdue: "border-red-500/50",
        "Due Today": "border-orange-500/50"
      }
    },
    defaultVariants: {
      status: "Planned"
    }
  }
);

type JobCardProps = {
  item: JobItem;
  isOverlay?: boolean;
  progressByItemId: Record<string, Progress>;
};

export function JobCard({ item, isOverlay, progressByItemId }: JobCardProps) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const submit = useSubmit();
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { displaySettings, selectedGroup, setSelectedGroup, tags, columnIds } =
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

  const status = progressByItemId[item.id]?.active
    ? "In Progress"
    : item.status;
  const employeeIds = progressByItemId[item.id]?.employees
    ? Array.from(progressByItemId[item.id].employees!)
    : undefined;

  const [customers] = useCustomers();

  const customer = customers.find((s) => s.id === item.customerId);
  const dueDate = getDateOnly(item.dueDate);
  const isDueDateValid = Boolean(dueDate && DATE_COLUMN_PATTERN.test(dueDate));
  const dueDateValue = isDueDateValid && dueDate ? dueDate : null;
  const scheduleColumnIds = columnIds ?? [];

  function submitDueDate(nextDueDate: string | null) {
    const columnId = nextDueDate
      ? nextDueDate
      : getEmptyDueDateColumnId(scheduleColumnIds, item.columnId);
    const optimisticColumnId = nextDueDate
      ? getOptimisticColumnId(nextDueDate, scheduleColumnIds)
      : columnId;

    submit(
      {
        id: item.id,
        columnId,
        optimisticColumnId,
        priority: item.priority
      },
      {
        method: "post",
        action: path.to.scheduleDatesUpdate,
        navigate: false,
        fetcherKey: `job:${item.id}`
      }
    );
  }

  const isOverdue =
    (item.dueDate &&
      status !== "Completed" &&
      new Date(item.dueDate) < new Date()) ||
    (item.dueDate &&
      item.completedDate &&
      status === "Completed" &&
      item.completedDate.split("T")[0] > item.dueDate);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "max-w-[330px]",
        item.hasConflict && "border-red-500 border-2",
        cardVariants({
          dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
          status: status,
          highlighted: isHighlighted
        })
      )}
    >
      <CardHeader className="flex flex-col justify-between relative gap-2">
        <div className="flex w-full max-w-full justify-between items-start gap-0">
          <div className="flex flex-col gap-0.5 space-y-0 min-w-0">
            {item.itemReadableId && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {item?.description || item.itemReadableId}
              </span>
            )}
            <HStack spacing={1} className="items-center">
              <Link
                to={
                  item.link ??
                  path.to.jobMethod(item.jobId, item.jobMakeMethodId)
                }
                className="mr-auto font-semibold line-clamp-2 leading-tight"
              >
                {item.jobReadableId}
              </Link>
              {item.hasConflict && (
                <Tooltip>
                  <TooltipTrigger>
                    <LuTriangleAlert className="h-4 w-4 text-red-500 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Scheduling conflict: operations cannot meet due date
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
            {customer && displaySettings.showCustomer && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {customer.name}
              </span>
            )}
          </div>
          <HStack spacing={1} className="flex-shrink-0 -mr-2">
            <IconButton
              aria-label={t`Move item`}
              icon={<LuGripVertical />}
              variant={"ghost"}
              {...attributes}
              {...listeners}
              className="cursor-grab"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {item.link && (
                  <DropdownMenuItem asChild>
                    <Link to={item.link}>
                      <DropdownMenuIcon icon={<LuPencil />} />
                      Edit Job
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
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </div>

        {displaySettings.showProgress &&
          Number.isFinite(item.progress) &&
          Number(item.progress) >= 0 && (
            <HStack>
              <BarProgress
                activeClassName={
                  status === "Completed" ? "bg-emerald-500" : "bg-blue-500"
                }
                progress={Math.min((item.progress ?? 0) * 100, 100)}
              />
              <LuClock className="text-muted-foreground w-4 h-4" />
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
        {displaySettings.showStatus && status && (
          <HStack className="justify-start space-x-2">
            <LuStar className="text-muted-foreground" />
            <JobStatus status={status} className="flex-shrink-0" />
            {isOverdue && (
              <JobStatus status="Overdue" className="flex-shrink-0" />
            )}
          </HStack>
        )}
        <HStack className="justify-start space-x-2">
          <AiOutlinePartition className="text-muted-foreground" />
          <span className="text-sm line-clamp-1">{item.itemReadableId}</span>
        </HStack>

        {displaySettings.showDueDate && item.deadlineType && (
          <HStack className="justify-start space-x-2">
            {getDeadlineIcon(item.deadlineType)}
            <Tooltip>
              <TooltipTrigger>
                <span className="text-sm">{item.deadlineType}</span>
              </TooltipTrigger>
              <TooltipContent side="right">{item.deadlineType}</TooltipContent>
            </Tooltip>
          </HStack>
        )}
        {displaySettings.showDueDate && (
          <HStack className="justify-start space-x-2">
            <LuCalendarDays />
            <DatePickerInput
              value={dueDateValue ? parseDate(dueDateValue) : null}
              isPreviewInline
              inline={
                dueDateValue ? (
                  <span className="text-sm">{formatDate(dueDateValue)}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t`Set due date`}
                  </span>
                )
              }
              onChange={(value) => {
                submitDueDate(value?.toString() ?? null);
              }}
            />
          </HStack>
        )}
        {displaySettings.showDueDate && item.completedDate && (
          <HStack className="justify-start space-x-2">
            <LuCircleCheck className="text-emerald-500" />
            <span className="text-sm">
              Completed {formatDate(item.completedDate)}
            </span>
          </HStack>
        )}

        {displaySettings.showQuantity &&
          Number.isFinite(item.quantity) &&
          Number(item.quantity) > 0 && (
            <HStack className="justify-start space-x-2">
              <LuCircleCheck className="text-muted-foreground" />
              <span className="text-sm">
                {item.quantityCompleted ?? 0}/{item.quantity} completed
              </span>
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

        {displaySettings.showEmployee &&
          Array.isArray(employeeIds) &&
          employeeIds.length > 0 && (
            <HStack className="justify-start space-x-2">
              <LuUsers className="text-muted-foreground" />
              <EmployeeAvatarGroup employeeIds={employeeIds} />
            </HStack>
          )}
      </CardContent>
      <CardFooter className="items-center justify-between text-xs flex-wrap">
        <HStack className="justify-start gap-2 w-full">
          <Assignee
            table="job"
            id={item.jobId}
            size="sm"
            value={item.assignee ?? undefined}
          />
        </HStack>
      </CardFooter>
    </Card>
  );
}
