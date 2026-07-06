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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TrackedEntityPicker,
  toast,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
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
import { useFetcher, useLoaderData } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import ItemThumbnail from "~/components/ItemThumbnail";
import { PickingListStatus } from "~/components/PickingListStatus";
import { ShortPickModal } from "~/components/ShortPickModal";
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
    pickingList: result.data
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

export default function PickingExecutionRoute() {
  const { pickingList } = useLoaderData<typeof loader>();

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
          size="lg"
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
          leftIcon={<LuCheck />}
          isLoading={isSubmitting}
          isDisabled={isSubmitting}
          onClick={() => setStatus("Completed")}
        >
          <Trans>Complete</Trans>
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
  isLocked
}: {
  kit: Kit;
  pickingListId: string;
  isLocked: boolean;
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
  isLocked
}: {
  line: Line;
  pickingListId: string;
  isLast: boolean;
  isLocked: boolean;
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

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6 p-4 border-b transition-opacity duration-150",
        isLast && "border-none",
        isResolved && "opacity-50 hover:opacity-100"
      )}
    >
      <HStack spacing={4} className="min-w-0 flex-1">
        <ItemThumbnail
          size="lg"
          thumbnailPath={null}
          type={(item?.type as "Part") ?? "Part"}
        />
        <VStack spacing={0} className="min-w-0">
          <p className="text-sm font-medium truncate">{itemName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {item?.readableIdWithRevision ?? lineItem?.readableId}
          </p>
        </VStack>
      </HStack>

      <HStack spacing={6} className="shrink-0">
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
        {isTracked ? (
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
        )}
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
          <HStack spacing={1}>
            {pickedLots.length === 1 ? (
              <Button
                size="lg"
                variant="secondary"
                leftIcon={<LuUndo2 />}
                onClick={() => unpickTracked(pickedLots[0].trackedEntityId)}
                isDisabled={isSubmitting}
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
          >
            <Trans>Unpick</Trans>
          </Button>
        ) : (
          <HStack spacing={1}>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => setShortOpen(true)}
              isDisabled={isSubmitting}
            >
              <Trans>Short</Trans>
            </Button>
            <Button
              size="lg"
              leftIcon={<LuCirclePlus />}
              onClick={() => pick(quantityToPick)}
              isLoading={isSubmitting}
              isDisabled={isSubmitting}
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
