import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  TrackedEntityOption,
  TrackedEntityPickOrder,
  TrackedEntitySelection
} from "@carbon/react";
import {
  Badge,
  BarProgress,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Count,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  SidebarTrigger,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TrackedEntityPicker,
  toast,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuCirclePlus,
  LuPlay,
  LuQrCode,
  LuTriangleAlert,
  LuUndo2
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useFetcher, useLoaderData } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import ItemThumbnail from "~/components/ItemThumbnail";
import { PickingListStatus } from "~/components/PickingListStatus";
import { ShortPickModal } from "~/components/ShortPickModal";
import type { PickingListRecommendation } from "~/services/inventory.service";
import { getPickingListRecommendations } from "~/services/inventory.service";
import { isPickingListLocked } from "~/services/models";
import { getPickingListForExecution } from "~/services/picking.service";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});
  const pickingListId = params.pickingListId!;

  const result = await getPickingListForExecution(client, pickingListId);

  if (result.error || !result.data) {
    throw new Response("Picking list not found", { status: 404 });
  }

  return {
    pickingList: result.data,
    // Deferred (not awaited): recommended serial/batch lots per line, streamed in
    // after the list paints so the at-a-glance subtext never blocks first render.
    recommendations: getPickingListRecommendations(client, pickingListId)
  };
}

type Line = NonNullable<
  Awaited<ReturnType<typeof getPickingListForExecution>>["data"]
>["lines"][number];

// A "kit" is the box a kitter fills for one job operation. Parts must not be
// mixed across operations, so lines are grouped by job operation — the job +
// operation + work center identify the box.
interface Kit {
  key: string;
  jobReadableId: string | null;
  operationName: string | null;
  workCenterName: string | null;
  lines: Line[];
}

type RecommendationsPromise = Promise<
  Record<string, PickingListRecommendation[]>
>;

export default function PickingExecutionRoute() {
  const { pickingList, recommendations } = useLoaderData<typeof loader>();

  const lines = pickingList.lines ?? [];
  const isLocked = isPickingListLocked(pickingList.status);

  const kits = useMemo(() => {
    const groups = new Map<string, Kit>();
    for (const line of lines) {
      const key = line.jobOperationId ?? "ungrouped";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          jobReadableId: (line.job as { jobId?: string } | null)?.jobId ?? null,
          operationName:
            (line.jobOperation as { process?: { name?: string } } | null)
              ?.process?.name ?? null,
          workCenterName:
            (line.jobOperation as { workCenter?: { name?: string } } | null)
              ?.workCenter?.name ?? null,
          lines: []
        });
      }
      groups.get(key)!.lines.push(line);
    }
    return Array.from(groups.values()).sort((a, b) => {
      const job = (a.jobReadableId ?? "").localeCompare(b.jobReadableId ?? "");
      if (job !== 0) return job;
      return (a.operationName ?? "").localeCompare(b.operationName ?? "");
    });
  }, [lines]);

  const completedCount = lines.filter((l) => isLineResolved(l)).length;

  return (
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center justify-between gap-2 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">{pickingList.pickingListId}</Heading>
          <PickingListStatus status={pickingList.status} />
        </div>
        <div className="flex items-center gap-3 px-3">
          <span className="text-sm text-muted-foreground tabular-nums">
            {completedCount}/{lines.length} <Trans>lines</Trans>
          </span>
          <PickingListControls
            pickingListId={pickingList.id}
            status={pickingList.status}
          />
        </div>
      </header>

      <main className="h-[calc(100dvh-var(--header-height))] w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent p-4">
        <div className="w-full max-w-5xl mx-auto pb-16">
          <VStack spacing={4} className="w-full">
            {kits.map((kit) => (
              <PickingKitCard
                key={kit.key}
                kit={kit}
                pickingListId={pickingList.id}
                isLocked={isLocked}
                recommendations={recommendations}
              />
            ))}
          </VStack>
        </div>
      </main>
    </div>
  );
}

function PickingListControls({
  pickingListId,
  status
}: {
  pickingListId: string;
  status: string;
}) {
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && fetcher.data.success === false) {
      toast.error(fetcher.data.message ?? "Failed to update status");
    }
  }, [fetcher.data]);

  const setStatus = (next: string) => {
    const formData = new FormData();
    formData.append("status", next);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingStatus(pickingListId)
    });
  };

  if (status === "Completed" || status === "Cancelled") return null;

  return (
    <HStack spacing={2}>
      {status === "Draft" && (
        <Button
          size="md"
          leftIcon={<LuPlay />}
          isLoading={isSubmitting}
          isDisabled={isSubmitting}
          onClick={() => setStatus("In Progress")}
        >
          <Trans>Start</Trans>
        </Button>
      )}
      {status === "In Progress" && (
        <Button
          size="md"
          variant="secondary"
          leftIcon={<LuCheck />}
          isLoading={isSubmitting}
          isDisabled={isSubmitting}
          onClick={() => setStatus("Completed")}
        >
          <Trans>Finish</Trans>
        </Button>
      )}
    </HStack>
  );
}

function isLineResolved(line: Line) {
  if (line.status === "Short" || line.status === "Cancelled") return true;
  return (
    Number(line.quantityToPick ?? 0) > 0 &&
    Number(line.quantityPicked ?? 0) >= Number(line.quantityToPick ?? 0)
  );
}

function PickingKitCard({
  kit,
  pickingListId,
  isLocked,
  recommendations
}: {
  kit: Kit;
  pickingListId: string;
  isLocked: boolean;
  recommendations: RecommendationsPromise;
}) {
  const totalToPick = kit.lines.reduce(
    (sum, l) => sum + Number(l.quantityToPick ?? 0),
    0
  );
  const totalPicked = kit.lines.reduce(
    (sum, l) =>
      sum +
      Math.min(Number(l.quantityPicked ?? 0), Number(l.quantityToPick ?? 0)),
    0
  );
  const progress = totalToPick > 0 ? (totalPicked / totalToPick) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {kit.jobReadableId ?? "Unknown Job"}
          {kit.operationName ? ` · ${kit.operationName}` : ""}
        </CardTitle>
        {kit.workCenterName && (
          <CardDescription>
            <Enumerable value={kit.workCenterName} />
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <BarProgress progress={progress} className="mb-4" />
        <div className="border rounded-lg">
          {kit.lines.map((line, index) => (
            <PickLineItem
              key={line.id}
              line={line}
              pickingListId={pickingListId}
              isLast={index === kit.lines.length - 1}
              isLocked={isLocked}
              recommendations={recommendations}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PickLineItem({
  line,
  pickingListId,
  isLast,
  isLocked,
  recommendations
}: {
  line: Line;
  pickingListId: string;
  isLast: boolean;
  isLocked: boolean;
  recommendations: RecommendationsPromise;
}) {
  const [items] = useItems();
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const isSubmitting = fetcher.state !== "idle";
  const [shortOpen, setShortOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const trackedFetcher = useFetcher<{
    entities: TrackedEntityOption[];
    trackingType: "Serial" | "Batch";
    quantityRequired: number;
    nearExpiryWarningDays: number;
    expiredEntityPolicy: "Warn" | "Block" | "BlockWithOverride";
    defaultOrder: TrackedEntityPickOrder;
  }>();

  useEffect(() => {
    if (fetcher.data && fetcher.data.success === false) {
      toast.error(fetcher.data.message ?? "Failed to update pick line");
    }
  }, [fetcher.data]);

  const lineItem = line.item as { name: string; readableId: string } | null;
  const item = items.find((i) => i.id === line.itemId);
  const itemName = item?.name ?? lineItem?.name ?? "";
  const source = (line.storageUnit as { name?: string } | null)?.name;
  const availableQuantity = Number(
    (line as { availableQuantity?: number }).availableQuantity ?? 0
  );
  const isShortStock = availableQuantity <= 0;
  const quantityToPick = Number(line.quantityToPick ?? 0);
  const quantityPicked = Number(line.quantityPicked ?? 0);
  const isTracked =
    item?.itemTrackingType === "Serial" || item?.itemTrackingType === "Batch";
  // Only lots actually PICKED (quantityPicked > 0) count as picked, not mere
  // allocations.
  const pickedLots = (
    (line.trackedEntities ?? []) as Array<{
      trackedEntityId: string;
      quantityPicked?: number | null;
      trackedEntity?: { readableId?: string | null } | null;
    }>
  ).filter((t) => Number(t.quantityPicked ?? 0) > 0);

  const isFullyPicked = quantityToPick > 0 && quantityPicked >= quantityToPick;
  const isShort = line.status === "Short";
  const isCancelled = line.status === "Cancelled";
  const isResolved = isFullyPicked || isShort || isCancelled;

  const pick = (quantity: number) => {
    const formData = new FormData();
    formData.append("pickingListLineId", line.id);
    formData.append("quantity", String(quantity));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingLineQuantity(pickingListId)
    });
  };

  const openPicker = () => {
    setPickerOpen(true);
    trackedFetcher.load(path.to.pickingTracked(pickingListId, line.id));
  };

  const pickTracked = (selection: TrackedEntitySelection) => {
    const formData = new FormData();
    formData.append("trackedEntityId", selection.trackedEntityId);
    formData.append("quantity", String(selection.quantity));
    if (selection.storageUnitId) {
      formData.append("fromStorageUnitId", selection.storageUnitId);
    }
    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingTracked(pickingListId, line.id)
    });
    setPickerOpen(false);
  };

  const unpickTracked = (trackedEntityId: string) => {
    const formData = new FormData();
    formData.append("trackedEntityId", trackedEntityId);
    formData.append("unpick", "true");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingTracked(pickingListId, line.id)
    });
  };

  const quantityBadge = isTracked ? (
    <Badge
      className={cn(
        "text-white text-base tabular-nums",
        isFullyPicked
          ? "bg-emerald-600"
          : quantityPicked > 0
            ? "bg-orange-500"
            : "bg-red-600"
      )}
    >
      {quantityPicked}/{quantityToPick}
    </Badge>
  ) : (
    <Count
      count={isShort ? quantityPicked : quantityToPick}
      className={cn(
        "text-white text-base tabular-nums",
        isFullyPicked
          ? "bg-emerald-600"
          : isShort
            ? "bg-orange-500"
            : "bg-red-600"
      )}
    />
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-4 border-b transition-opacity duration-150",
        "sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        isLast && "border-none",
        isResolved && "opacity-60 hover:opacity-100"
      )}
    >
      {/* Identity — item, part number, suggested lots, and (mobile) the count */}
      <div className="flex items-start justify-between gap-4 min-w-0 sm:flex-1">
        <HStack spacing={4} className="min-w-0">
          <ItemThumbnail
            size="xl"
            thumbnailPath={null}
            type={(item?.type as "Part") ?? "Part"}
          />
          <VStack spacing={1} className="min-w-0">
            <p className="truncate text-base font-medium">{itemName}</p>
            <p className="truncate font-mono text-sm text-muted-foreground">
              {item?.readableIdWithRevision ?? lineItem?.readableId}
            </p>
            {isTracked && !isFullyPicked && (
              <RecommendedLots resolve={recommendations} lineId={line.id} />
            )}
          </VStack>
        </HStack>
        <div className="shrink-0 sm:hidden">{quantityBadge}</div>
      </div>

      {/* Controls — source, count (desktop), and pick actions */}
      <div className="flex items-center justify-end gap-3 sm:gap-6 sm:shrink-0">
        {source ? (
          <div className="text-base font-medium whitespace-nowrap">
            {source}
          </div>
        ) : isShortStock && !isFullyPicked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="yellow"
                className="gap-1 py-2 px-3 text-sm cursor-default"
              >
                <LuTriangleAlert />
                <Trans>No stock</Trans>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px]">
              <Trans>
                No warehouse stock is on record for this item. You can still
                pick it — on-hand will go negative until the count is
                reconciled.
              </Trans>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <div className="hidden sm:block">{quantityBadge}</div>
        {isLocked ? (
          isCancelled ? (
            <Badge variant="red">
              <Trans>Cancelled</Trans>
            </Badge>
          ) : null
        ) : isCancelled ? (
          <Badge variant="red">
            <Trans>Cancelled</Trans>
          </Badge>
        ) : isTracked ? (
          <HStack spacing={1} className="flex-1 justify-end sm:flex-none">
            {pickedLots.length === 1 ? (
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuUndo2 />}
                onClick={() => unpickTracked(pickedLots[0].trackedEntityId)}
                isDisabled={isSubmitting}
                className="flex-1 sm:flex-none"
              >
                {pickedLots[0].trackedEntity?.readableId ? (
                  <Trans>Unpick {pickedLots[0].trackedEntity.readableId}</Trans>
                ) : (
                  <Trans>Unpick</Trans>
                )}
              </Button>
            ) : pickedLots.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="lg"
                    variant="secondary"
                    leftIcon={<LuUndo2 />}
                    rightIcon={<LuChevronDown />}
                    isDisabled={isSubmitting}
                    className="flex-1 sm:flex-none"
                  >
                    <Trans>Unpick</Trans>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {pickedLots.map((lot) => (
                    <DropdownMenuItem
                      key={lot.trackedEntityId}
                      onClick={() => unpickTracked(lot.trackedEntityId)}
                    >
                      <DropdownMenuIcon icon={<LuUndo2 />} />
                      {lot.trackedEntity?.readableId ?? lot.trackedEntityId}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {!isFullyPicked && (
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuQrCode />}
                onClick={openPicker}
                isDisabled={isSubmitting}
                className="flex-1 sm:flex-none"
              >
                <Trans>Scan</Trans>
              </Button>
            )}
          </HStack>
        ) : isFullyPicked ? (
          <Button
            size="lg"
            variant="secondary"
            leftIcon={<LuUndo2 />}
            onClick={() => pick(0)}
            isLoading={isSubmitting}
            isDisabled={isSubmitting}
            className="flex-1 sm:flex-none"
          >
            <Trans>Unpick</Trans>
          </Button>
        ) : (
          <HStack spacing={1} className="flex-1 justify-end sm:flex-none">
            <Button
              size="lg"
              variant="secondary"
              onClick={() => setShortOpen(true)}
              isDisabled={isSubmitting}
              className="flex-1 sm:flex-none"
            >
              <Trans>Short</Trans>
            </Button>
            <Button
              size="lg"
              leftIcon={<LuCirclePlus />}
              onClick={() => pick(quantityToPick)}
              isLoading={isSubmitting}
              isDisabled={isSubmitting}
              className="flex-1 sm:flex-none"
            >
              <Trans>Pick</Trans>
            </Button>
          </HStack>
        )}
      </div>

      {shortOpen && (
        <ShortPickModal
          pickingListId={pickingListId}
          lineId={line.id}
          itemName={itemName}
          quantityToPick={quantityToPick}
          quantityPicked={quantityPicked}
          onClose={() => setShortOpen(false)}
        />
      )}

      {pickerOpen && (
        <TrackedEntityPicker
          size="lg"
          trackingType={
            item?.itemTrackingType === "Serial" ? "Serial" : "Batch"
          }
          entities={trackedFetcher.data?.entities ?? []}
          quantityRequired={Math.max(0, quantityToPick - quantityPicked)}
          title={`Pick ${itemName}`}
          description="Choose a lot to pick — expiring/oldest first."
          nearExpiryWarningDays={
            trackedFetcher.data?.nearExpiryWarningDays ?? 0
          }
          expiredEntityPolicy={
            trackedFetcher.data?.expiredEntityPolicy ?? "Warn"
          }
          defaultOrder={trackedFetcher.data?.defaultOrder}
          onSelect={pickTracked}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * At-a-glance recommended serial/batch numbers for a tracked line, streamed in
 * from the deferred list-wide recommendations so the row paints immediately.
 * Rendered as large, touch-readable monospace chips, no label — the chips
 * speak for themselves.
 */
function RecommendedLots({
  resolve,
  lineId
}: {
  resolve: RecommendationsPromise;
  lineId: string;
}) {
  return (
    <Suspense fallback={<Skeleton className="mt-2 h-8 w-44 rounded-md" />}>
      <Await resolve={resolve} errorElement={null}>
        {(byLine) => {
          const lots = byLine?.[lineId] ?? [];
          if (lots.length === 0) return null;
          return (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-base">
              {lots.map((lot) => (
                <span
                  key={lot.trackedEntityId}
                  className="max-w-full truncate rounded-md border border-border bg-background px-3 py-1 font-mono tabular-nums text-foreground shadow-sm"
                >
                  {lot.readableId ?? lot.trackedEntityId}
                </span>
              ))}
            </div>
          );
        }}
      </Await>
    </Suspense>
  );
}
