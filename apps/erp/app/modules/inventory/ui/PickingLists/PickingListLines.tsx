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
  HStack,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TrackedEntityPicker,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  LuChevronDown,
  LuCirclePlus,
  LuQrCode,
  LuTriangleAlert,
  LuUndo2
} from "react-icons/lu";
import { Await, useFetcher } from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions } from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { isPickingListLocked } from "../../inventory.models";
import type {
  getPickingList,
  getPickingListLines,
  PickingListRecommendation
} from "../../inventory.service";
import { ShortPickModal } from "./ShortPickModal";

type PickingListData = NonNullable<
  Awaited<ReturnType<typeof getPickingList>>["data"]
>;

type PickingListLineData = NonNullable<
  Awaited<ReturnType<typeof getPickingListLines>>["data"]
>;

type RecommendationsPromise = Promise<
  Record<string, PickingListRecommendation[]>
>;

type PickingListLinesProps = {
  pickingListLines: PickingListLineData;
  pickingListId: string;
  pickingList: PickingListData;
  recommendations: RecommendationsPromise;
};

// A "kit" is the box a kitter fills for one job operation. Parts must not be
// mixed across operations, so lines are grouped by job operation — the job +
// operation + work center identify the box.
type Kit = {
  key: string;
  jobReadableId: string | null;
  operationName: string | null;
  workCenterName: string | null;
  lines: PickingListLineData;
};

const PickingListLines = ({
  pickingListLines,
  pickingListId,
  pickingList,
  recommendations
}: PickingListLinesProps) => {
  const isLocked = isPickingListLocked(pickingList?.status);
  const kits = useMemo(() => {
    const groups = new Map<string, Kit>();
    for (const line of pickingListLines) {
      const key = line.jobOperationId ?? "ungrouped";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          jobReadableId: line.job?.jobId ?? null,
          operationName: line.jobOperation?.process?.name ?? null,
          workCenterName: line.jobOperation?.workCenter?.name ?? null,
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
  }, [pickingListLines]);

  if (kits.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Picking Lines</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            <Empty className="py-6" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <VStack spacing={4} className="w-full">
      {kits.map((kit) => (
        <PickingKitCard
          key={kit.key}
          kit={kit}
          pickingListId={pickingListId}
          isLocked={isLocked}
          recommendations={recommendations}
        />
      ))}
    </VStack>
  );
};

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
            <PickingListLineItem
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

function PickingListLineItem({
  line,
  pickingListId,
  isLast,
  isLocked,
  recommendations
}: {
  line: PickingListLineData[number];
  pickingListId: string;
  isLast: boolean;
  isLocked: boolean;
  recommendations: RecommendationsPromise;
}) {
  const permissions = usePermissions();
  const { t } = useLingui();
  const [items] = useItems();
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const isPending = fetcher.state !== "idle";
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
      toast.error(fetcher.data.message ?? "Failed to pick line");
    }
  }, [fetcher.data]);

  const openPicker = () => {
    setPickerOpen(true);
    trackedFetcher.load(path.to.pickingListTracked(pickingListId, line.id));
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
      action: path.to.pickingListTracked(pickingListId, line.id)
    });
    setPickerOpen(false);
  };

  const unpickTracked = (trackedEntityId: string) => {
    const formData = new FormData();
    formData.append("trackedEntityId", trackedEntityId);
    formData.append("unpick", "true");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingListTracked(pickingListId, line.id)
    });
  };

  const item = items.find((i) => i.id === line.itemId);
  const itemName = item?.name ?? line.item?.name ?? "";
  const quantityToPick = Number(line.quantityToPick ?? 0);
  const quantityPicked = Number(line.quantityPicked ?? 0);
  const isPicked = quantityToPick > 0 && quantityPicked >= quantityToPick;
  const isShort = line.status === "Short";
  const isResolved = isPicked || isShort;
  const isTracked =
    item?.itemTrackingType === "Serial" || item?.itemTrackingType === "Batch";
  const source = (line as { storageUnit?: { name?: string } }).storageUnit
    ?.name;
  // Warehouse on-hand available (incl. the unassigned/null bin). A null source
  // bin is NOT a shortage if there's on-hand sitting in the unassigned bin.
  const availableQuantity = Number(
    (line as { availableQuantity?: number }).availableQuantity ?? 0
  );
  const isShortStock = availableQuantity <= 0;
  // Only lots that were actually PICKED (quantityPicked > 0) count as picked —
  // not mere allocations.
  const pickedLots = (
    (
      line as {
        trackedEntities?: Array<{
          trackedEntityId: string;
          quantityPicked?: number | null;
          trackedEntity?: { readableId?: string | null } | null;
        }>;
      }
    ).trackedEntities ?? []
  ).filter((t) => Number(t.quantityPicked ?? 0) > 0);
  const canPick = permissions.can("update", "inventory");

  const pick = (quantity: number) => {
    const formData = new FormData();
    formData.append("pickingListLineId", line.id);
    formData.append("quantity", String(quantity));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingListLineQuantity(pickingListId)
    });
  };

  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-6 p-4 border-b",
        isLast && "border-none"
      )}
    >
      <HStack
        spacing={4}
        className={cn(
          "min-w-0 flex-1 transition-opacity duration-150",
          isResolved && "opacity-50 group-hover:opacity-100"
        )}
      >
        <ItemThumbnail
          size="xl"
          thumbnailPath={null}
          type={(item?.type as "Part") ?? "Part"}
        />
        <VStack spacing={0} className="min-w-0">
          <p className="truncate text-base font-medium sm:text-sm">
            {itemName}
          </p>
          <p className="truncate font-mono text-sm text-muted-foreground sm:text-xs">
            {item?.readableIdWithRevision ?? line.item?.readableId}
          </p>
          {isTracked && !isPicked && (
            <RecommendedLots resolve={recommendations} lineId={line.id} />
          )}
        </VStack>
      </HStack>

      <HStack spacing={6} className="shrink-0">
        {source ? (
          <div className="text-base font-medium whitespace-nowrap">
            {source}
          </div>
        ) : isShortStock && !isPicked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="yellow"
                className="gap-1 py-1.5 px-2.5 cursor-default"
              >
                <LuTriangleAlert />
                <Trans>No stock</Trans>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-[240px]">
              <Trans>
                No warehouse stock is on record for this item. You can still
                pick it — on-hand will go negative until the count is
                reconciled.
              </Trans>
            </TooltipContent>
          </Tooltip>
        ) : null}
        {isTracked ? (
          <Badge
            variant={isPicked ? "green" : quantityPicked > 0 ? "orange" : "red"}
            className="text-base tabular-nums"
          >
            {quantityPicked}/{quantityToPick}
          </Badge>
        ) : (
          <Count
            count={isShort ? quantityPicked : quantityToPick}
            variant={isPicked ? "green" : isShort ? "orange" : "red"}
            className="text-base tabular-nums"
          />
        )}
        {isLocked ? null : isTracked ? (
          <HStack spacing={1}>
            {pickedLots.length === 1 ? (
              <Button
                variant="secondary"
                leftIcon={<LuUndo2 />}
                isDisabled={!canPick || isPending}
                onClick={() => unpickTracked(pickedLots[0].trackedEntityId)}
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
                    variant="secondary"
                    leftIcon={<LuUndo2 />}
                    rightIcon={<LuChevronDown />}
                    isDisabled={!canPick || isPending}
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
            {!isPicked && (
              <Button
                variant="secondary"
                leftIcon={<LuQrCode />}
                isDisabled={!canPick || isPending}
                onClick={openPicker}
              >
                <Trans>Scan</Trans>
              </Button>
            )}
          </HStack>
        ) : isPicked ? (
          <Button
            variant="secondary"
            leftIcon={<LuUndo2 />}
            isDisabled={!canPick || isPending}
            isLoading={isPending}
            onClick={() => pick(0)}
          >
            <Trans>Unpick</Trans>
          </Button>
        ) : (
          <HStack spacing={1}>
            <Button
              variant="secondary"
              isDisabled={!canPick || isPending}
              onClick={() => setShortOpen(true)}
            >
              <Trans>Short</Trans>
            </Button>
            <Button
              leftIcon={<LuCirclePlus />}
              isDisabled={!canPick || isPending}
              isLoading={isPending}
              onClick={() => pick(quantityToPick)}
            >
              <Trans>Pick</Trans>
            </Button>
          </HStack>
        )}
      </HStack>

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
          trackingType={
            item?.itemTrackingType === "Serial" ? "Serial" : "Batch"
          }
          entities={trackedFetcher.data?.entities ?? []}
          quantityRequired={Math.max(0, quantityToPick - quantityPicked)}
          title={`Pick ${itemName}`}
          description={
            item?.itemTrackingType === "Serial"
              ? t`Choose a serial number`
              : t`Choose a batch number`
          }
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
 * Rendered as readable monospace chips, no label — the chips speak for themselves.
 */
function RecommendedLots({
  resolve,
  lineId
}: {
  resolve: RecommendationsPromise;
  lineId: string;
}) {
  return (
    <Suspense
      fallback={<Skeleton className="mt-2 h-6 w-36 rounded-md sm:h-5" />}
    >
      <Await resolve={resolve} errorElement={null}>
        {(byLine) => {
          const lots = byLine?.[lineId] ?? [];
          if (lots.length === 0) return null;
          return (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-base sm:text-sm">
              {lots.map((lot) => (
                <span
                  key={lot.trackedEntityId}
                  className="max-w-full truncate rounded-md border border-border bg-muted px-2 py-0.5 font-mono tabular-nums text-foreground"
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

export default PickingListLines;
