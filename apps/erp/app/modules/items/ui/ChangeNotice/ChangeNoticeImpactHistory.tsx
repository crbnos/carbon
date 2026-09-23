import {
  Badge,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Skeleton,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { type ReactNode, useEffect, useRef } from "react";
import { LuHistory } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import type {
  ChangeNoticeActionTask,
  ChangeNoticeImpactHistoryEntry,
  ChangeNoticeImpactHistoryReadModel,
  ChangeNoticeImpactHistorySnapshotStatus,
  ChangeNoticeImpactWorkspaceCandidate,
  ChangeNoticeImpactWorkspaceSnapshot
} from "~/modules/items";
import { path } from "~/utils/path";
import { SnapshotFacts } from "./ChangeNoticeImpactSnapshotFacts";

type HistoryFetcherData =
  | ChangeNoticeImpactHistoryReadModel
  | { data: null; error: { message: string } };

type ChangeNoticeImpactHistoryProps = {
  changeNoticeId: string;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  actions: ChangeNoticeActionTask[];
  onClose: () => void;
};

const decisionEvents = new Set([
  "Decision created",
  "Decision resolved",
  "Decision reassessed",
  "Conclusion corrected",
  "Decision reopened"
]);

function domainLabel(
  targetType: ChangeNoticeImpactWorkspaceCandidate["targetType"]
) {
  switch (targetType) {
    case "purchaseOrderLine":
      return <Trans>Purchase Order line</Trans>;
    case "job":
      return <Trans>Producing Job</Trans>;
    case "jobMaterial":
      return <Trans>Job Material</Trans>;
  }
}

function statusLabel(status: ChangeNoticeImpactHistoryEntry["newStatus"]) {
  switch (status) {
    case "No action required":
      return <Trans>No action required</Trans>;
    case "Action required":
      return <Trans>Action required</Trans>;
    case "Resolved":
      return <Trans>Resolved</Trans>;
    default:
      return status;
  }
}

function reasonLabel(reason: ChangeNoticeImpactHistoryEntry["newReasonCode"]) {
  switch (reason) {
    case "Outside effectivity":
      return <Trans>Outside effectivity</Trans>;
    case "Not affected after review":
      return <Trans>Not affected after review</Trans>;
    case "No purchasing intervention remains":
      return <Trans>No purchasing intervention remains</Trans>;
    default:
      return reason;
  }
}

function eventLabel(eventType: string) {
  switch (eventType) {
    case "Decision created":
      return <Trans>Assessment created</Trans>;
    case "Decision resolved":
      return <Trans>Assessment resolved</Trans>;
    case "Decision reassessed":
      return <Trans>Assessment reassessed</Trans>;
    case "Conclusion corrected":
      return <Trans>Conclusion corrected</Trans>;
    case "Decision reopened":
      return <Trans>Assessment reopened</Trans>;
    case "Provenance started":
      return <Trans>Provenance started</Trans>;
    case "Provenance ended":
      return <Trans>Provenance ended</Trans>;
    case "Task linked":
      return <Trans>Task linked</Trans>;
    case "Task unlinked":
      return <Trans>Task unlinked</Trans>;
    case "Task designated as Impact follow-up":
      return <Trans>Task designated as Impact follow-up</Trans>;
    default:
      return eventType || <Trans>Impact event</Trans>;
  }
}

function CurrentState({
  candidate
}: {
  candidate: ChangeNoticeImpactWorkspaceCandidate;
}) {
  const decision = candidate.decision;
  const currentSnapshotMessage =
    candidate.sourceAvailability === "Source deleted" ? (
      <Trans>
        Current source facts are unavailable because the source was deleted.
      </Trans>
    ) : undefined;

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/40 p-3 text-xs">
      <div className="font-medium">
        <Trans>Current state</Trans>
      </div>
      <div>
        <span className="text-muted-foreground">
          <Trans>Conclusion</Trans>:
        </span>{" "}
        {decision ? statusLabel(decision.status) : <Trans>Unassessed</Trans>}
      </div>
      {decision?.noActionReasonCode && (
        <div>
          <span className="text-muted-foreground">
            <Trans>No-action reason</Trans>:
          </span>{" "}
          {reasonLabel(decision.noActionReasonCode)}
        </div>
      )}
      {candidate.freshness === "Changed since assessment" && (
        <Badge
          variant="outline"
          className="w-fit border-orange-500/50 text-orange-700 dark:text-orange-300"
        >
          <Trans>Changed since assessment</Trans>
        </Badge>
      )}
      <SnapshotFacts
        candidate={candidate}
        emptyMessage={currentSnapshotMessage}
      />
      {decision?.rationale && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Rationale</Trans>:
          </span>{" "}
          {decision.rationale}
        </div>
      )}
      {decision?.resolutionNote && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Resolution note</Trans>:
          </span>{" "}
          {decision.resolutionNote}
        </div>
      )}
    </div>
  );
}

function SnapshotHistoryPanel({
  label,
  status,
  snapshot,
  candidate
}: {
  label: ReactNode;
  status: ChangeNoticeImpactHistorySnapshotStatus;
  snapshot: ChangeNoticeImpactWorkspaceSnapshot | null;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
}) {
  if (status === "absent") return null;
  return (
    <div className="space-y-1">
      <div className="font-medium text-muted-foreground">{label}</div>
      <SnapshotFacts
        candidate={candidate}
        snapshot={snapshot}
        emptyMessage={<Trans>Stored assessment snapshot is unavailable.</Trans>}
      />
    </div>
  );
}

function AssessmentEvent({
  entry,
  candidate
}: {
  entry: ChangeNoticeImpactHistoryEntry;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
}) {
  const hasPreviousStatus = entry.previousStatus !== null;
  const hasNewStatus = entry.newStatus !== null;
  const hasSnapshot =
    entry.previousSnapshotStatus !== "absent" ||
    entry.newSnapshotStatus !== "absent";

  return (
    <div className="space-y-2 text-xs">
      {(hasPreviousStatus || hasNewStatus) && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Conclusion</Trans>:
          </span>{" "}
          {hasPreviousStatus
            ? statusLabel(entry.previousStatus)
            : hasNewStatus
              ? statusLabel(entry.newStatus)
              : null}
          {hasPreviousStatus &&
            hasNewStatus &&
            entry.previousStatus !== entry.newStatus && (
              <>
                <span className="px-1 text-muted-foreground">→</span>
                {statusLabel(entry.newStatus)}
              </>
            )}
        </div>
      )}
      {(entry.previousReasonCode || entry.newReasonCode) && (
        <div>
          <span className="text-muted-foreground">
            <Trans>No-action reason</Trans>:
          </span>{" "}
          {entry.previousReasonCode
            ? reasonLabel(entry.previousReasonCode)
            : entry.newReasonCode
              ? reasonLabel(entry.newReasonCode)
              : null}
          {entry.previousReasonCode &&
            entry.newReasonCode &&
            entry.previousReasonCode !== entry.newReasonCode && (
              <>
                <span className="px-1 text-muted-foreground">→</span>
                {reasonLabel(entry.newReasonCode)}
              </>
            )}
        </div>
      )}
      {entry.rationale && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Rationale</Trans>:
          </span>{" "}
          {entry.rationale}
        </div>
      )}
      {entry.resolutionNote && (
        <div>
          <span className="text-muted-foreground">
            <Trans>Resolution note</Trans>:
          </span>{" "}
          {entry.resolutionNote}
        </div>
      )}
      {entry.priorAssessmentWasChanged && (
        <div className="text-orange-700 dark:text-orange-300">
          <Trans>
            Current source facts had changed since the prior assessment.
          </Trans>
        </div>
      )}
      {hasSnapshot && (
        <details className="rounded-md border border-border/70 px-3 py-2">
          <summary className="cursor-pointer font-medium">
            <Trans>Assessment snapshot</Trans>
          </summary>
          <div className="mt-2 space-y-3">
            <SnapshotHistoryPanel
              label={
                entry.previousSnapshotStatus === "absent" ? (
                  <Trans>Captured snapshot</Trans>
                ) : (
                  <Trans>Before</Trans>
                )
              }
              status={entry.previousSnapshotStatus}
              snapshot={entry.previousSnapshot}
              candidate={candidate}
            />
            <SnapshotHistoryPanel
              label={
                entry.previousSnapshotStatus === "absent" ? (
                  <Trans>Captured snapshot</Trans>
                ) : (
                  <Trans>After</Trans>
                )
              }
              status={entry.newSnapshotStatus}
              snapshot={entry.newSnapshot}
              candidate={candidate}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function TaskEvent({
  entry,
  task
}: {
  entry: ChangeNoticeImpactHistoryEntry;
  task: ChangeNoticeActionTask | undefined;
}) {
  return (
    <div className="space-y-1 text-xs">
      <div>
        <span className="text-muted-foreground">
          <Trans>Task</Trans>:
        </span>{" "}
        {task ? (
          (task.name ?? <Trans>Unnamed task</Trans>)
        ) : (
          <span className="italic text-muted-foreground">
            <Trans>Task details unavailable.</Trans>
          </span>
        )}
      </div>
      {entry.rationale &&
        entry.eventType === "Task designated as Impact follow-up" && (
          <div className="text-muted-foreground">{entry.rationale}</div>
        )}
    </div>
  );
}

function ProvenanceEvent({ entry }: { entry: ChangeNoticeImpactHistoryEntry }) {
  return (
    <div className="space-y-1 text-xs">
      <div>
        <span className="text-muted-foreground">
          <Trans>Affected item</Trans>:
        </span>{" "}
        {entry.provenance?.affectedItemLabel ?? (
          <span className="italic text-muted-foreground">
            <Trans>Affected item details unavailable.</Trans>
          </span>
        )}
      </div>
      {entry.eventType === "Provenance ended" &&
        (entry.provenance?.endedReason ?? entry.rationale) && (
          <div>
            <span className="text-muted-foreground">
              <Trans>Reason</Trans>:
            </span>{" "}
            {entry.provenance?.endedReason ?? entry.rationale}
          </div>
        )}
    </div>
  );
}

function HistoryEntryCard({
  entry,
  candidate,
  actions
}: {
  entry: ChangeNoticeImpactHistoryEntry;
  candidate: ChangeNoticeImpactWorkspaceCandidate;
  actions: ChangeNoticeActionTask[];
}) {
  const task = entry.relatedActionTaskId
    ? actions.find((action) => action.id === entry.relatedActionTaskId)
    : undefined;

  return (
    <div className="w-full rounded-lg border bg-muted/40 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {entry.createdBy ? (
            <EmployeeAvatar employeeId={entry.createdBy} />
          ) : (
            <span className="font-medium">
              <Trans>System</Trans>
            </span>
          )}
          <DateTime value={entry.createdAt} variant="absolute" />
        </div>
        <Badge variant="outline" className="shrink-0">
          {eventLabel(entry.eventType)}
        </Badge>
      </div>
      {decisionEvents.has(entry.eventType) ? (
        <AssessmentEvent entry={entry} candidate={candidate} />
      ) : entry.eventType === "Task linked" ||
        entry.eventType === "Task unlinked" ||
        entry.eventType === "Task designated as Impact follow-up" ? (
        <TaskEvent entry={entry} task={task} />
      ) : entry.eventType === "Provenance started" ||
        entry.eventType === "Provenance ended" ? (
        <ProvenanceEvent entry={entry} />
      ) : (
        <p className="text-xs italic text-muted-foreground">
          <Trans>Event details are unavailable for this event type.</Trans>
        </p>
      )}
    </div>
  );
}

export function ChangeNoticeImpactHistory({
  changeNoticeId,
  candidate,
  actions,
  onClose
}: ChangeNoticeImpactHistoryProps) {
  const fetcher = useFetcher<HistoryFetcherData>();
  const lastLoadedRef = useRef<string | null>(null);
  const decisionId = candidate.decision?.id ?? "";
  const loadKey = `${changeNoticeId}:${decisionId}`;

  useEffect(() => {
    if (
      !decisionId ||
      fetcher.state !== "idle" ||
      lastLoadedRef.current === loadKey
    ) {
      return;
    }
    lastLoadedRef.current = loadKey;
    fetcher.load(path.to.changeNoticeImpactHistory(changeNoticeId, decisionId));
  }, [changeNoticeId, decisionId, fetcher, fetcher.state, loadKey]);

  const response = fetcher.data;
  const errorMessage =
    response && "error" in response ? response.error.message : null;
  const entries = response && "entries" in response ? response.entries : [];
  const isLoading = fetcher.state === "loading" || response === undefined;
  const itemLabel =
    candidate.item?.readableIdWithRevision ??
    candidate.item?.readableId ??
    null;

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="lg" position="right">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <LuHistory className="size-5" />
            <span>
              <Trans>Impact history</Trans>
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {domainLabel(candidate.targetType)}
                {itemLabel ? ` · ${itemLabel}` : ""}
              </span>
            </span>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <div className="min-w-0 w-full space-y-3">
            <CurrentState candidate={candidate} />
            {isLoading ? (
              <VStack spacing={3}>
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </VStack>
            ) : errorMessage ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {errorMessage}
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                <Trans>No history is recorded for this assessment.</Trans>
              </div>
            ) : (
              <VStack spacing={3}>
                {entries.map((entry) => (
                  <HistoryEntryCard
                    key={entry.id}
                    entry={entry}
                    candidate={candidate}
                    actions={actions}
                  />
                ))}
              </VStack>
            )}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
