import { Button, HStack, toast } from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import {
  LuCalendarClock,
  LuLayers,
  LuPlus,
  LuTimer,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { useBatchSelection } from "../context/BatchSelectionContext";
import type { BatchItem } from "../types";

// Warn when batching couples due dates further apart than this: the batch runs
// at its most-urgent member's time, so everything else is pulled early (or the
// urgent one waits).
const DUE_SPREAD_WARNING_DAYS = 7;

// Floating action bar that appears while operations are selected for
// batching. Submits the same `batching.update` action the rest of the batch
// lifecycle uses; the server's eligibility gate is the real validator, so any
// rejection surfaces here as a toast. When an Active batch on the selection's
// process is already on the board, offers "Add to BAT…" beside "Create batch".
export function BatchSelectionBar({
  locationId,
  batches
}: {
  locationId: string;
  batches: BatchItem[];
}) {
  const { t } = useLingui();
  const selection = useBatchSelection();
  const fetcher = useFetcher<{ success?: boolean; message?: string }>();

  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (fetcher.state !== "idle") {
      wasSubmitting.current = true;
      return;
    }
    if (!wasSubmitting.current) return;
    wasSubmitting.current = false;
    if (fetcher.data?.success === false && fetcher.data.message) {
      toast.error(fetcher.data.message);
    } else if (fetcher.data?.success) {
      selection?.clear();
    }
  }, [fetcher.state, fetcher.data, selection]);

  if (!selection || selection.selectedIds.size === 0) return null;

  const count = selection.selectedIds.size;
  const isSubmitting = fetcher.state !== "idle";

  // The value pitch: one setup instead of N. Batched setup = the largest member
  // setup; unbatched = the sum of all of them.
  const setups = selection.selectedItems.map((i) => i.setupDuration ?? 0);
  const setupSum = setups.reduce((acc, s) => acc + s, 0);
  const setupMax = Math.max(0, ...setups);
  const showSetupSaving = setupMax > 0 && setupSum > setupMax;

  // Due-date coupling: days between the earliest and latest member due dates.
  const dueDates = selection.selectedItems
    .map((i) => i.dueDate)
    .filter((d): d is string => Boolean(d))
    .map((d) => parseDate(d));
  const dueSpreadDays =
    dueDates.length >= 2
      ? Math.abs(
          dueDates
            .reduce((max, d) => (d.compare(max) > 0 ? d : max))
            .compare(
              dueDates.reduce((min, d) => (d.compare(min) < 0 ? d : min))
            )
        )
      : 0;
  const showDueSpreadWarning = dueSpreadDays >= DUE_SPREAD_WARNING_DAYS;

  // Existing Active batches on the pinned process — targets for "Add to".
  const targetBatches = batches.filter(
    (batch) =>
      batch.batchStatus === "Active" &&
      batch.columnType === selection.selectedProcessId
  );

  const submitSelection = (fd: FormData) => {
    for (const id of selection.selectedIds) {
      fd.append("jobOperationIds", id);
    }
    fetcher.submit(fd, {
      method: "post",
      action: path.to.priorityBatchingUpdate
    });
  };

  const createBatch = () => {
    const fd = new FormData();
    fd.set("intent", "create");
    fd.set("locationId", locationId);
    submitSelection(fd);
  };

  const addToBatch = (batchId: string) => {
    const fd = new FormData();
    fd.set("intent", "add");
    fd.set("batchId", batchId);
    submitSelection(fd);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
      <HStack
        spacing={2}
        className="pointer-events-auto rounded-full border bg-card px-4 py-2 shadow-lg"
      >
        <span className="text-sm tabular-nums text-muted-foreground">
          {t`${count} selected`}
        </span>
        {showSetupSaving && (
          <span
            className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs tabular-nums text-emerald-600 dark:text-emerald-400"
            title={t`One shared setup instead of one per operation`}
          >
            <LuTimer className="size-3" />
            {t`Setup ${formatDurationMilliseconds(setupSum, {
              style: "short"
            })} → ${formatDurationMilliseconds(setupMax, { style: "short" })}`}
          </span>
        )}
        {showDueSpreadWarning && (
          <span
            className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs tabular-nums text-amber-600 dark:text-amber-400"
            title={t`The batch runs at its most urgent member's time — the others are pulled early`}
          >
            <LuCalendarClock className="size-3" />
            {t`Due dates span ${dueSpreadDays} days`}
          </span>
        )}
        <Button
          size="sm"
          leftIcon={<LuLayers />}
          isLoading={isSubmitting}
          isDisabled={isSubmitting}
          onClick={createBatch}
        >
          {t`Create batch`}
        </Button>
        {targetBatches.slice(0, 2).map((batch) => (
          <Button
            key={batch.batchId}
            size="sm"
            variant="secondary"
            leftIcon={<LuPlus />}
            isDisabled={isSubmitting}
            onClick={() => addToBatch(batch.batchId)}
          >
            {t`Add to ${batch.batchReadableId}`}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<LuX />}
          onClick={() => selection.clear()}
        >
          {t`Clear`}
        </Button>
      </HStack>
    </div>
  );
}
