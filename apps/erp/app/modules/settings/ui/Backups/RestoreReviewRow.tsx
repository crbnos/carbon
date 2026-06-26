import { Button, HStack, VStack } from "@carbon/react";
import { LuLoaderCircle } from "react-icons/lu";

export type RestoreRun = {
  restoreRunId: string;
  status: "running" | "ready" | "failed" | "reverting";
  rows: number;
  label: string | null;
  error: string | null;
  startedAt: string;
};

// One row in the "Restored — review" card, branching on the run's status.
export function RestoreReviewRow({
  run,
  onKeep,
  onRevert,
  onDismiss
}: {
  run: RestoreRun;
  onKeep: () => void;
  onRevert: () => void;
  onDismiss: () => void;
}) {
  const busy = run.status === "running" || run.status === "reverting";
  return (
    <HStack className="w-full justify-between border rounded-lg p-3">
      <VStack spacing={0} className="min-w-0">
        <span className="text-sm font-medium truncate">
          {run.label ?? "Restore"}
        </span>
        {run.status === "failed" ? (
          <span className="text-xs text-destructive-foreground">
            Failed — {run.error ?? "unknown error"}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {new Date(run.startedAt).toLocaleString()} ·{" "}
            {run.status === "running"
              ? "restoring…"
              : run.status === "reverting"
                ? "reverting…"
                : `${run.rows.toLocaleString()} rows`}
          </span>
        )}
      </VStack>
      <HStack spacing={2} className="shrink-0">
        {run.status === "ready" && (
          <>
            <Button onClick={onKeep}>Keep</Button>
            <Button variant="destructive" onClick={onRevert}>
              Revert
            </Button>
          </>
        )}
        {run.status === "failed" && (
          <Button variant="secondary" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
        {busy && (
          <LuLoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </HStack>
    </HStack>
  );
}
