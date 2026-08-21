import { Button, HStack, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { LuLayers, LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { useBatchSelection } from "../context/BatchSelectionContext";

// Floating action bar that appears while operations are selected for
// batching. Submits the same `batching.update` action the rest of the batch
// lifecycle uses; the server's eligibility gate is the real validator, so any
// rejection surfaces here as a toast.
export function BatchSelectionBar({ locationId }: { locationId: string }) {
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

  const createBatch = () => {
    const fd = new FormData();
    fd.set("intent", "create");
    fd.set("locationId", locationId);
    for (const id of selection.selectedIds) {
      fd.append("jobOperationIds", id);
    }
    fetcher.submit(fd, {
      method: "post",
      action: path.to.scheduleBatchingUpdate
    });
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
        <Button
          size="sm"
          leftIcon={<LuLayers />}
          isLoading={isSubmitting}
          isDisabled={isSubmitting}
          onClick={createBatch}
        >
          {t`Create batch`}
        </Button>
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
