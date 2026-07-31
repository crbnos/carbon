import { Status } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";

// One source for how an Onshape sync reads on screen: the status → chip
// mapping, the copy for every skip reason and trigger, and the read-side stall
// threshold. The part sidebar block and the sync dashboard both render from
// here so a status can never mean two different things in two places.

export const onshapeSyncStatuses = [
  "queued",
  "running",
  "synced",
  "skipped",
  "failed"
] as const;
export type OnshapeSyncStatus = (typeof onshapeSyncStatuses)[number];

export const onshapeRunStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const;
export type OnshapeRunStatus = (typeof onshapeRunStatuses)[number];

export const onshapeSyncSources = ["webhook", "backfill", "manual"] as const;
export type OnshapeSyncSource = (typeof onshapeSyncSources)[number];

export const onshapeAssetKinds = ["model", "drawing"] as const;
export type OnshapeAssetKind = (typeof onshapeAssetKinds)[number];

export const onshapeSyncSkipReasons = [
  "revision-not-found",
  "asset-too-large",
  "ambiguous-item"
] as const;
export type OnshapeSyncSkipReason = (typeof onshapeSyncSkipReasons)[number];

type StatusChipColor = "green" | "blue" | "gray" | "yellow" | "red";

const statusChipColors: Record<OnshapeSyncStatus, StatusChipColor> = {
  synced: "green",
  running: "blue",
  queued: "gray",
  skipped: "yellow",
  failed: "red"
};

const runStatusChipColors: Record<OnshapeRunStatus, StatusChipColor> = {
  completed: "green",
  running: "blue",
  queued: "gray",
  cancelled: "gray",
  failed: "red"
};

/**
 * An item row that has sat in `queued` this long reads as stalled: the sidebar
 * says the sync did not complete and re-enables the pull button. Read-side
 * only — the next write from the sync flips the row back to live.
 */
export const ONSHAPE_ITEM_STALL_MS = 10 * 60 * 1000;

/**
 * A bulk sync that has not written progress for this long reads as stalled on
 * the dashboard. Read-side only, and a warning only: starting another sync
 * stays blocked until the run reaches an explicit terminal state, so a wedged
 * run has to be cancelled first.
 */
export const ONSHAPE_RUN_STALL_MS = 30 * 60 * 1000;

// The state columns are TEXT with CHECK constraints rather than enums, so a
// value arrives as a plain string and gets narrowed once, here, at the edge.
export function asOnshapeSyncStatus(
  value: string | null | undefined
): OnshapeSyncStatus | null {
  return onshapeSyncStatuses.includes(value as OnshapeSyncStatus)
    ? (value as OnshapeSyncStatus)
    : null;
}

export function asOnshapeRunStatus(
  value: string | null | undefined
): OnshapeRunStatus | null {
  return onshapeRunStatuses.includes(value as OnshapeRunStatus)
    ? (value as OnshapeRunStatus)
    : null;
}

export function asOnshapeAssetKind(
  value: string | null | undefined
): OnshapeAssetKind | null {
  return onshapeAssetKinds.includes(value as OnshapeAssetKind)
    ? (value as OnshapeAssetKind)
    : null;
}

export function asOnshapeSyncSource(
  value: string | null | undefined
): OnshapeSyncSource | null {
  return onshapeSyncSources.includes(value as OnshapeSyncSource)
    ? (value as OnshapeSyncSource)
    : null;
}

export function asOnshapeSyncSkipReason(
  value: string | null | undefined
): OnshapeSyncSkipReason | null {
  return onshapeSyncSkipReasons.includes(value as OnshapeSyncSkipReason)
    ? (value as OnshapeSyncSkipReason)
    : null;
}

export function isOnshapeSyncInFlight(
  row: { status: string; createdAt: string; updatedAt?: string | null } | null
): boolean {
  const status = asOnshapeSyncStatus(row?.status);
  if (status !== "queued" && status !== "running") return false;
  return !isOnshapeSyncStalled(row);
}

export function isOnshapeSyncStalled(
  row: { status: string; createdAt: string; updatedAt?: string | null } | null,
  now: number = Date.now()
): boolean {
  if (!row || asOnshapeSyncStatus(row.status) !== "queued") return false;
  const referenceTimestamp = Date.parse(row.updatedAt ?? row.createdAt);
  if (Number.isNaN(referenceTimestamp)) return false;
  return now - referenceTimestamp > ONSHAPE_ITEM_STALL_MS;
}

export function isOnshapeRunLive(
  run: { status: string } | null | undefined
): boolean {
  const status = asOnshapeRunStatus(run?.status);
  return status === "queued" || status === "running";
}

export function isOnshapeRunStalled(
  run:
    | { status: string; createdAt: string; updatedAt?: string | null }
    | null
    | undefined,
  now: number = Date.now()
): boolean {
  if (!run || !isOnshapeRunLive(run)) return false;
  const lastProgressTimestamp = Date.parse(run.updatedAt ?? run.createdAt);
  if (Number.isNaN(lastProgressTimestamp)) return false;
  return now - lastProgressTimestamp > ONSHAPE_RUN_STALL_MS;
}

/** How long a sync has been running, or how long it took. */
export function formatOnshapeSyncDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function onshapeDocumentUrl(
  locator: {
    documentId: string;
    versionId: string;
    elementId: string;
  },
  baseUrl?: string | null
): string {
  // Enterprise Onshape runs on custom domains — the integration's stored
  // baseUrl wins; the public host is only the fallback for viewers who cannot
  // read the integration config (it needs settings_view).
  const host = (baseUrl ?? "https://cad.onshape.com").replace(/\/+$/, "");
  return `${host}/documents/${locator.documentId}/v/${locator.versionId}/e/${locator.elementId}`;
}

/**
 * The user-facing copy for a sync's status, skip reason and trigger. Product
 * facts only — a stored reason code never reaches the screen.
 */
export function useOnshapeSyncLabels() {
  const { t } = useLingui();

  return useMemo(
    () => ({
      statusLabel: (status: OnshapeSyncStatus): string => {
        switch (status) {
          case "synced":
            return t`Synced`;
          case "running":
            return t`Syncing`;
          case "queued":
            return t`Queued`;
          case "skipped":
            return t`Skipped`;
          case "failed":
            return t`Failed`;
        }
      },
      runStatusLabel: (status: OnshapeRunStatus): string => {
        switch (status) {
          case "completed":
            return t`Completed`;
          case "running":
            return t`Running`;
          case "queued":
            return t`Queued`;
          case "cancelled":
            return t`Cancelled`;
          case "failed":
            return t`Failed`;
        }
      },
      assetKindLabel: (assetKind: string | null | undefined): string => {
        switch (asOnshapeAssetKind(assetKind)) {
          case "model":
            return t`Model`;
          case "drawing":
            return t`Drawing`;
          default:
            return t`Asset`;
        }
      },
      skipReasonLabel: (reason: string | null | undefined): string => {
        switch (asOnshapeSyncSkipReason(reason)) {
          case "revision-not-found":
            return t`No released revision found`;
          case "asset-too-large":
            return t`File too large to sync`;
          case "ambiguous-item":
            return t`Matches more than one part`;
          default:
            return t`Skipped`;
        }
      },
      sourceLabel: (source: string | null | undefined): string | null => {
        switch (asOnshapeSyncSource(source)) {
          case "webhook":
            return t`Automatic`;
          case "backfill":
            return t`Bulk sync`;
          case "manual":
            return t`Manual`;
          default:
            return null;
        }
      },
      observedOnlyLabel: t`Existing attachment confirmed`,
      stalledLabel: t`Sync did not complete — try again`,
      runStalledLabel: t`No progress for 30 minutes`
    }),
    [t]
  );
}

export function OnshapeSyncStatusChip({
  status,
  className
}: {
  status: OnshapeSyncStatus;
  className?: string;
}) {
  const { statusLabel } = useOnshapeSyncLabels();

  return (
    <Status color={statusChipColors[status]} className={className}>
      {statusLabel(status)}
    </Status>
  );
}

export function OnshapeRunStatusChip({
  status,
  className
}: {
  status: OnshapeRunStatus;
  className?: string;
}) {
  const { runStatusLabel } = useOnshapeSyncLabels();

  return (
    <Status color={runStatusChipColors[status]} className={className}>
      {runStatusLabel(status)}
    </Status>
  );
}
