import {
  Badge,
  BarProgress,
  Card,
  CardContent,
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
  formatDurationMilliseconds
} from "@carbon/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import {
  LuCalendarDays,
  LuCircleCheck,
  LuEllipsisVertical,
  LuGripVertical,
  LuLayers,
  LuPlay,
  LuPrinter,
  LuSquareUser,
  LuTimer,
  LuTrash,
  LuUsers,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { CustomerAvatar, DateTime, OperationStatusIcon } from "~/components";
import { useDateFormatter } from "~/hooks";
import { getDeadlineIcon } from "~/modules/production/ui/Jobs/Deadline";
import { path } from "~/utils/path";
import { KANBAN_CARD_SHELL } from "../cardShell";
import { useKanban } from "../context/KanbanContext";
import type { BatchItem, OperationItem } from "../types";
import { useScheduleToday } from "../useScheduleToday";

// The order a batch summary reports its members' statuses in: the most "live"
// status wins, so a planner sees the batch is running the moment any member is.
const STATUS_RANK: Record<string, number> = {
  "In Progress": 6,
  Paused: 5,
  Ready: 4,
  Todo: 3,
  Waiting: 2,
  Done: 1,
  Canceled: 0
};

function rollupStatus(members: OperationItem[]): OperationItem["status"] {
  let best: OperationItem["status"] | undefined;
  let bestRank = -1;
  for (const m of members) {
    const s = m.status ?? "Todo";
    const rank = STATUS_RANK[s] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = s;
    }
  }
  return best ?? "Todo";
}

// The collapsed schedule-board card for an operation batch. An explicit variant
// of the operation card, not ItemCard with flags: a batch has its own anatomy
// (member rows, dissolve, MES link) and its own drag semantics (dragging it to
// another column reassigns the batch work center). It builds ON the operation
// card's information design — the same display-setting rows (status, progress,
// due date, customer, duration, materials) rolled up across members — rather
// than dropping them; the member list sits beneath that summary.
export function BatchItemCard({
  item,
  isOverlay
}: {
  item: BatchItem;
  isOverlay?: boolean;
}) {
  const { t } = useLingui();
  const { formatRelativeTime } = useDateFormatter();
  const { displaySettings } = useKanban();
  const scheduleToday = useScheduleToday();
  const fetcher = useFetcher();
  const isCompleting = item.batchStatus === "Completing";
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: item.id,
    data: { type: "item", item },
    attributes: { roleDescription: "item" },
    disabled: isCompleting
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform)
  };

  const members = item.members;
  const totalQty = members.reduce((sum, m) => sum + (m.quantity ?? 0), 0);

  // Aggregations across the members — what the batch, as one run, amounts to.
  const status = rollupStatus(members);
  const totalTarget = members.reduce(
    (sum, m) => sum + (m.targetQuantity ?? m.quantity ?? 0),
    0
  );
  const totalCompleted = members.reduce(
    (sum, m) => sum + (m.quantityCompleted ?? 0),
    0
  );
  const totalReworked = members.reduce(
    (sum, m) => sum + (m.quantityReworked ?? 0),
    0
  );
  const totalScrapped = members.reduce(
    (sum, m) => sum + (m.quantityScrapped ?? 0),
    0
  );
  const totalDuration = members.reduce((sum, m) => sum + (m.duration ?? 0), 0);
  // The earliest member due date is the batch's binding constraint.
  const earliest = members.reduce<OperationItem | undefined>((acc, m) => {
    if (!m.dueDate) return acc;
    if (!acc?.dueDate || m.dueDate < acc.dueDate) return m;
    return acc;
  }, undefined);
  const isOverdue =
    earliest?.deadlineType !== "No Deadline" && earliest?.dueDate
      ? earliest.dueDate < scheduleToday
      : false;
  const distinctCustomers = [
    ...new Set(members.map((m) => m.customerId).filter(Boolean))
  ] as string[];
  const materialChips = [
    ...new Set(members.flatMap((m) => m.materialChips ?? []))
  ];

  const submitBatch = (fd: FormData) => {
    fetcher.submit(fd, {
      method: "post",
      action: path.to.priorityBatchingUpdate
    });
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "max-w-[330px]",
        KANBAN_CARD_SHELL,
        isOverlay && "ring-2 ring-primary",
        isDragging && "ring-2 ring-primary opacity-30"
      )}
    >
      <CardHeader className="flex flex-col justify-between relative gap-2">
        <div className="flex w-full max-w-full justify-between items-start gap-0">
          <HStack spacing={2} className="min-w-0">
            <LuLayers className="text-muted-foreground size-4 flex-shrink-0" />
            <Badge>{item.batchReadableId}</Badge>
            {isCompleting && <Badge variant="yellow">{t`Completing`}</Badge>}
            <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
              {members.length} · {totalQty}
            </span>
          </HStack>
          <HStack spacing={1} className="flex-shrink-0 -mr-2">
            {!isCompleting && (
              <IconButton
                aria-label={t`Move batch`}
                icon={<LuGripVertical />}
                variant="ghost"
                {...attributes}
                {...listeners}
                className="cursor-grab"
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <a href={path.to.external.mesBatch(item.batchId)}>
                    <DropdownMenuIcon icon={<LuPlay />} />
                    {t`Open in MES`}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={path.to.file.batchLoadList(item.batchId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <DropdownMenuIcon icon={<LuPrinter />} />
                    {t`Print load list`}
                  </a>
                </DropdownMenuItem>
                {!isCompleting && (
                  <DropdownMenuItem
                    destructive
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("intent", "dissolve");
                      fd.set("batchId", item.batchId);
                      submitBatch(fd);
                    }}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    {t`Dissolve batch`}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </div>
        {isCompleting && (
          <a
            href={path.to.external.mesBatch(item.batchId)}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t`Completion in progress — retry in Shop Floor`}
          </a>
        )}
        {displaySettings.showProgress && totalTarget > 0 && (
          <HStack>
            <BarProgress
              segments={[
                { value: totalCompleted, className: "bg-emerald-500" },
                { value: totalReworked, className: "bg-yellow-500" },
                { value: totalScrapped, className: "bg-red-500" }
              ]}
              max={totalTarget || 1}
              progress={
                totalCompleted ? (totalCompleted / totalTarget) * 100 : 0
              }
            />
            <LuCircleCheck className="text-muted-foreground w-4 h-4" />
          </HStack>
        )}
      </CardHeader>
      <CardContent className="gap-2 text-left text-sm">
        {/* Aggregated summary rows — the operation card's information design,
            carried onto the batch rather than dropped. */}
        {displaySettings.showStatus && (
          <HStack className="justify-start space-x-2">
            {/* Read-only: a batch has N members, so the status is a rolled-up
                summary, not an editable per-operation control. */}
            <OperationStatusIcon status={status ?? "Todo"} className="size-4" />
            <span className="text-sm">{status}</span>
          </HStack>
        )}
        {displaySettings.showDuration && totalDuration > 0 && (
          <HStack className="justify-start space-x-2">
            <LuTimer className="text-muted-foreground" />
            <span className="text-sm">
              {formatDurationMilliseconds(totalDuration)}
            </span>
          </HStack>
        )}
        {displaySettings.showDueDate && earliest?.deadlineType && (
          <HStack className="justify-start space-x-2">
            {getDeadlineIcon(earliest.deadlineType)}
            <Tooltip>
              <TooltipTrigger>
                <span
                  className={cn("text-sm", isOverdue ? "text-red-500" : "")}
                >
                  {["ASAP", "No Deadline"].includes(earliest.deadlineType)
                    ? earliest.deadlineType
                    : earliest.dueDate
                      ? `Due ${formatRelativeTime(
                          convertDateStringToIsoString(earliest.dueDate)
                        )}`
                      : "–"}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {earliest.deadlineType}
              </TooltipContent>
            </Tooltip>
          </HStack>
        )}
        {displaySettings.showDueDate && earliest?.dueDate && (
          <HStack className="justify-start space-x-2">
            <LuCalendarDays />
            <span className="text-sm">
              <DateTime value={earliest.dueDate} variant="date" />
            </span>
          </HStack>
        )}
        {displaySettings.showCustomer && distinctCustomers.length > 0 && (
          <HStack className="justify-start space-x-2">
            <LuSquareUser className="text-muted-foreground" />
            {distinctCustomers.length === 1 ? (
              <CustomerAvatar customerId={distinctCustomers[0]} />
            ) : (
              <span className="text-sm text-muted-foreground">
                {t`${distinctCustomers.length} customers`}
              </span>
            )}
          </HStack>
        )}
        {displaySettings.showMaterial && materialChips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {materialChips.map((chip) => (
              <Badge key={chip} variant="secondary" className="text-xs">
                {chip}
              </Badge>
            ))}
          </div>
        )}

        {/* The member jobs in the batch — each still individually removable. */}
        <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <LuUsers className="size-3.5" />
          <span>{t`Jobs`}</span>
        </div>
        {members.map((m) => (
          <div
            key={m.id}
            className="group flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5"
          >
            <div className="min-w-0">
              <span className="block truncate text-xs font-medium">
                {m.jobReadableId}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {m.itemReadableId}
              </span>
            </div>
            <HStack spacing={1} className="flex-shrink-0">
              <span className="text-xs tabular-nums text-muted-foreground">
                {m.quantity ?? 0}
              </span>
              {!isCompleting && (
                <IconButton
                  aria-label={t`Remove from batch`}
                  icon={<LuX />}
                  variant="ghost"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("intent", "remove");
                    fd.set("batchId", item.batchId);
                    fd.append("jobOperationIds", m.id);
                    submitBatch(fd);
                  }}
                />
              )}
            </HStack>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
