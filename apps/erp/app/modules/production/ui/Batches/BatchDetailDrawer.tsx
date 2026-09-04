import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Progress,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef } from "react";
import {
  LuCirclePlay,
  LuHammer,
  LuHardHat,
  LuLayers,
  LuPlus,
  LuPrinter,
  LuStickyNote,
  LuTimer,
  LuTrash,
  LuUndo2
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { DateTime, EmployeeAvatar, ItemThumbnail } from "~/components";
import { path } from "~/utils/path";
import type {
  JobOperationBatchDetail,
  JobOperationBatchEvent
} from "../../types";
import { BatchStatus } from "./BatchesTable";
import { batchPlanBreakdown } from "./batch-builder-logic";

const EVENT_TYPES = ["Setup", "Labor", "Machine"] as const;
type EventType = (typeof EVENT_TYPES)[number];

const EVENT_ICONS: Record<
  EventType,
  React.ComponentType<{ className?: string }>
> = {
  Setup: LuTimer,
  Labor: LuHardHat,
  Machine: LuHammer
};

function memberStatusVariant(status: string | null) {
  switch (status) {
    case "Done":
      return "green" as const;
    case "In Progress":
      return "yellow" as const;
    default:
      return "secondary" as const;
  }
}

export function BatchDetailDrawer({
  batch,
  events,
  onClose
}: {
  batch: JobOperationBatchDetail;
  events: JobOperationBatchEvent[];
  onClose: () => void;
}) {
  const { t } = useLingui();

  const isLive = batch.status === "Active" || batch.status === "Completing";
  // Planned and Active batches stay composable/dissolvable; the edge fn's
  // production-event guard is what actually freezes a started batch.
  const isPreStart = batch.status === "Planned" || batch.status === "Active";

  // Release (Planned → Active) / Unrelease (Active → Planned). The server's
  // refusal (no work center, production already recorded) comes back as
  // { success: false, message } and lands in the toast; success revalidates
  // the loader and the badge flips.
  const releaseFetcher = useFetcher<{
    success?: boolean;
    message?: string;
  }>();
  const wasReleasing = useRef(false);
  useEffect(() => {
    if (releaseFetcher.state !== "idle") {
      wasReleasing.current = true;
      return;
    }
    if (!wasReleasing.current) return;
    wasReleasing.current = false;
    const d = releaseFetcher.data;
    if (d?.success === false && d.message) {
      toast.error(d.message);
    }
  }, [releaseFetcher.state, releaseFetcher.data]);

  const submitBatchIntent = (intent: "release" | "unrelease") => {
    releaseFetcher.submit(
      { intent, batchId: batch.id },
      { method: "post", action: path.to.priorityBatchingUpdate }
    );
  };

  // Planned durations, batch semantics (mirrors the MES operation view): ONE
  // shared setup — the largest member's — plus labor/machine summed. Missing
  // units default to Total Minutes (setup) / Minutes/Piece (labor, machine).
  const plan = useMemo(() => {
    const { setup, labor, machine } = batchPlanBreakdown(batch.members ?? [], {
      setupUnit: "Total Minutes",
      laborUnit: "Minutes/Piece",
      machineUnit: "Minutes/Piece"
    });
    return { Setup: setup, Labor: labor, Machine: machine };
  }, [batch.members]);

  // Actual durations from the batch's events. `duration` is generated SECONDS;
  // an open event (endTime null) accrues from startTime to render time —
  // absolute-instant math, allowed by the date rule's narrow exception.
  const { actual, openEvent } = useMemo(() => {
    const totals = { Setup: 0, Labor: 0, Machine: 0 };
    let open: JobOperationBatchEvent | null = null;
    const now = Date.now();
    for (const e of events) {
      const type = (e.type ?? "Machine") as EventType;
      if (e.endTime == null) {
        open = e;
        if (e.startTime) {
          totals[type] += Math.max(0, now - Date.parse(e.startTime));
        }
      } else {
        totals[type] += (e.duration ?? 0) * 1000;
      }
    }
    return { actual: totals, openEvent: open };
  }, [events]);

  const shownTypes = EVENT_TYPES.filter(
    (type) => plan[type] > 0 || actual[type] > 0
  );

  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          Date.parse(b.startTime ?? "1970-01-01") -
          Date.parse(a.startTime ?? "1970-01-01")
      ),
    [events]
  );

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="full">
        <DrawerHeader className="px-6 flex-shrink-0">
          <DrawerTitle>{batch.readableId}</DrawerTitle>
          <HStack spacing={2} className="pt-1 flex-wrap">
            <BatchStatus status={batch.status} />
            {batch.process?.name && (
              <span className="text-sm text-muted-foreground">
                {batch.process.name}
              </span>
            )}
            {batch.workCenterName && (
              <span className="text-sm text-muted-foreground">
                {batch.workCenterName}
              </span>
            )}
            {batch.location?.name && (
              <span className="text-sm text-muted-foreground">
                {batch.location.name}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Trans>Created</Trans>{" "}
              <DateTime value={batch.createdAt} variant="date" />
              <EmployeeAvatar employeeId={batch.createdBy} size="xs" />
            </span>
          </HStack>
          {batch.status === "Planned" && (
            <p className="pt-1 text-sm text-muted-foreground">
              <Trans>Not on the shop floor — release to dispatch</Trans>
            </p>
          )}
          {batch.notes && (
            <HStack
              spacing={1}
              className="pt-2 items-start text-sm text-muted-foreground"
            >
              <LuStickyNote className="size-3.5 flex-shrink-0 mt-0.5" />
              <span className="text-pretty">{batch.notes}</span>
            </HStack>
          )}
        </DrawerHeader>

        <div className="flex-1 min-h-0 w-full overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>
                  <Trans>Members</Trans>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Compact cell padding — eight columns must fit the card
                    without clipping the Status column. */}
                <Table className="[&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4">
                  <Thead>
                    <Tr>
                      <Th>
                        <Trans>Job</Trans>
                      </Th>
                      <Th>
                        <Trans>Item</Trans>
                      </Th>
                      <Th>
                        <Trans>Operation</Trans>
                      </Th>
                      <Th className="whitespace-nowrap">
                        <Trans>Work Center</Trans>
                      </Th>
                      <Th className="text-right">
                        <Trans>Qty</Trans>
                      </Th>
                      <Th>
                        <Trans>Status</Trans>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {batch.members.map((member) => (
                      <Tr key={member.id}>
                        <Td className="font-medium">
                          {member.job?.id ? (
                            <Link
                              to={path.to.jobDetails(member.job.id)}
                              className="hover:underline"
                            >
                              {member.job.jobId}
                            </Link>
                          ) : (
                            member.job?.jobId
                          )}
                        </Td>
                        <Td>
                          <HStack spacing={2}>
                            <ItemThumbnail
                              thumbnailPath={
                                member.jobMakeMethod?.item?.thumbnailPath ??
                                null
                              }
                              type="Part"
                              size="sm"
                            />
                            <VStack spacing={0} className="min-w-0">
                              <span className="max-w-[22ch] truncate text-sm">
                                {member.jobMakeMethod?.item
                                  ?.readableIdWithRevision ?? "—"}
                              </span>
                              <span
                                className="max-w-[22ch] truncate text-xs text-muted-foreground"
                                title={
                                  member.jobMakeMethod?.item?.name ?? undefined
                                }
                              >
                                {member.jobMakeMethod?.item?.name}
                              </span>
                            </VStack>
                          </HStack>
                        </Td>
                        <Td className="text-muted-foreground">
                          <span
                            className="line-clamp-1 max-w-[18ch]"
                            title={member.description ?? undefined}
                          >
                            {member.description}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap text-muted-foreground">
                          {member.workCenter?.name}
                        </Td>
                        <Td className="text-right">
                          <VStack spacing={0} className="items-end">
                            <span className="tabular-nums">
                              {member.quantityComplete ?? 0}/
                              {member.operationQuantity ?? 0}
                            </span>
                            {(member.quantityScrapped ?? 0) > 0 && (
                              <span className="text-xs tabular-nums text-red-500">
                                {t`${member.quantityScrapped} scrapped`}
                              </span>
                            )}
                          </VStack>
                        </Td>
                        <Td>
                          <Badge variant={memberStatusVariant(member.status)}>
                            {member.status}
                          </Badge>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </CardContent>
            </Card>

            <Card className="lg:col-span-1 self-start">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>
                  <Trans>Run</Trans>
                </CardTitle>
                {openEvent && (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                    </span>
                    <Trans>Timer running</Trans>
                  </span>
                )}
              </CardHeader>
              <CardContent>
                <VStack spacing={4}>
                  {shownTypes.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      <Trans>No planned or recorded time.</Trans>
                    </span>
                  )}
                  {shownTypes.map((type) => {
                    const Icon = EVENT_ICONS[type];
                    const planned = plan[type];
                    const done = actual[type];
                    const percent =
                      planned > 0
                        ? Math.min(100, Math.round((done / planned) * 100))
                        : done > 0
                          ? 100
                          : 0;
                    return (
                      <VStack key={type} spacing={1} className="w-full">
                        <HStack className="w-full justify-between">
                          <span className="flex items-center gap-1.5 text-sm">
                            <Icon className="size-3.5 text-muted-foreground" />
                            {type === "Setup" ? (
                              <Trans>Setup</Trans>
                            ) : type === "Labor" ? (
                              <Trans>Labor</Trans>
                            ) : (
                              <Trans>Machine</Trans>
                            )}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatDurationMilliseconds(done, {
                              style: "short"
                            })}
                            {planned > 0 && (
                              <>
                                {" / "}
                                {formatDurationMilliseconds(planned, {
                                  style: "short"
                                })}
                              </>
                            )}
                          </span>
                        </HStack>
                        <Progress
                          value={percent}
                          className={cn(
                            "h-1.5",
                            done > planned &&
                              planned > 0 &&
                              "[&>div]:bg-amber-500"
                          )}
                        />
                      </VStack>
                    );
                  })}

                  <VStack spacing={1} className="w-full pt-2 border-t">
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      <Trans>Production events</Trans>
                    </span>
                    {sortedEvents.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        <Trans>No production recorded yet.</Trans>
                      </span>
                    ) : (
                      <VStack
                        spacing={0}
                        className="w-full max-h-[280px] overflow-y-auto"
                      >
                        {sortedEvents.map((event) => {
                          const Icon =
                            EVENT_ICONS[(event.type ?? "Machine") as EventType];
                          const isOpen = event.endTime == null;
                          return (
                            <HStack
                              key={event.id}
                              className="w-full justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50 transition-colors"
                            >
                              <HStack spacing={2} className="min-w-0">
                                <Icon className="size-3.5 flex-shrink-0 text-muted-foreground" />
                                <EmployeeAvatar
                                  employeeId={event.employeeId}
                                  size="xs"
                                />
                                {event.startTime && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    <DateTime
                                      value={event.startTime}
                                      variant="relative"
                                    />
                                  </span>
                                )}
                              </HStack>
                              <span
                                className={cn(
                                  "flex-shrink-0 text-xs tabular-nums",
                                  isOpen
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-muted-foreground"
                                )}
                              >
                                {isOpen
                                  ? t`Running`
                                  : formatDurationMilliseconds(
                                      (event.duration ?? 0) * 1000,
                                      { style: "short" }
                                    )}
                              </span>
                            </HStack>
                          );
                        })}
                      </VStack>
                    )}
                  </VStack>
                </VStack>
              </CardContent>
            </Card>
          </div>
        </div>

        <DrawerFooter className="flex-shrink-0 border-t bg-card sm:justify-end items-center">
          <HStack spacing={2}>
            {isPreStart && (
              <Button variant="destructive" leftIcon={<LuTrash />} asChild>
                <Link to={path.to.deleteOperationBatch(batch.id)}>
                  {t`Dissolve`}
                </Link>
              </Button>
            )}
            {batch.status === "Active" && (
              <Button
                variant="secondary"
                leftIcon={<LuUndo2 />}
                isLoading={releaseFetcher.state !== "idle"}
                isDisabled={releaseFetcher.state !== "idle"}
                onClick={() => submitBatchIntent("unrelease")}
              >
                {t`Unrelease`}
              </Button>
            )}
            <Button variant="secondary" leftIcon={<LuPrinter />} asChild>
              <a
                href={path.to.file.batchLoadList(batch.id)}
                target="_blank"
                rel="noreferrer"
              >
                {t`Print load list`}
              </a>
            </Button>
            {isPreStart && (
              <Button variant="secondary" leftIcon={<LuPlus />} asChild>
                <Link to={`${path.to.newOperationBatch}?batchId=${batch.id}`}>
                  {t`Add operations`}
                </Link>
              </Button>
            )}
            {isLive && (
              <Button variant="secondary" leftIcon={<LuLayers />} asChild>
                <Link to={path.to.priorityOperation}>
                  {t`View on schedule board`}
                </Link>
              </Button>
            )}
            {batch.status === "Planned" &&
              (batch.workCenterId ? (
                <Button
                  variant="primary"
                  leftIcon={<LuCirclePlay />}
                  isLoading={releaseFetcher.state !== "idle"}
                  isDisabled={releaseFetcher.state !== "idle"}
                  onClick={() => submitBatchIntent("release")}
                >
                  {t`Release`}
                </Button>
              ) : (
                // A disabled button swallows pointer events, so the tooltip
                // hangs on a wrapper — the server refuses a release without a
                // work center.
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="primary"
                        leftIcon={<LuCirclePlay />}
                        isDisabled
                      >
                        {t`Release`}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t`Assign a work center first`}
                  </TooltipContent>
                </Tooltip>
              ))}
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
