// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { auditConfig, getTableLabel } from "@carbon/database/audit.config";
import type { AuditLogEntry } from "@carbon/database/audit.types";
import {
  Badge,
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { memo, useEffect, useRef, useState } from "react";
import {
  LuDownload,
  LuFilePen,
  LuFilePlus,
  LuFileX,
  LuHistory,
  LuSettings
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { DateTime, EmployeeAvatar, Empty } from "~/components";
import {
  UpgradeOverlayActions,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayInline,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";
import { usePermissions, useRouteData } from "~/hooks";
import { useResolved } from "~/hooks/useResolved";
import { path } from "~/utils/path";
import { useAuditLogDownload } from "./useAuditLogDownload";
import { isEmptyDiffValue } from "./utils";

type AuditLogDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  companyId: string;
  title?: React.ReactNode;
  /**
   * Optional: scope the view to a single raw row rather than the full entity.
   * When set, the drawer filters audit entries to `recordId = recordId`.
   */
  recordId?: string;
  /** When true, shows an upgrade prompt instead of fetching audit data */
  planRestricted?: boolean;
  /** When true, the header offers a CSV download of the full history. */
  downloadable?: boolean;
  /** Leads the downloaded file's name, e.g. the record's readable id. */
  downloadName?: string;
};

/** How long after a change its audit rows typically take to be written. */
const AUDIT_SETTLE_MS = 4000;

type AuditLogFetcherData = {
  entries: AuditLogEntry[];
};

const operationLabels: Record<
  string,
  { label: string; variant: "green" | "blue" | "red"; icon: React.ReactNode }
> = {
  INSERT: {
    label: "Created",
    variant: "green",
    icon: <LuFilePlus className="size-3" />
  },
  UPDATE: {
    label: "Updated",
    variant: "blue",
    icon: <LuFilePen className="size-3" />
  },
  DELETE: {
    label: "Deleted",
    variant: "red",
    icon: <LuFileX className="size-3" />
  }
};

type AuditLogFeedProps = {
  entityType: string;
  entityId: string;
  companyId: string;
  /**
   * Optional: scope the view to a single raw row rather than the full entity.
   * When set, the feed filters audit entries to `recordId = recordId`.
   */
  recordId?: string;
  /** When true, shows an upgrade prompt instead of fetching audit data */
  planRestricted?: boolean;
  /** The feed loads only while active (an open drawer, a selected tab). */
  isActive: boolean;
  /**
   * Changes whenever the entity may have new history (e.g. its `updatedAt`),
   * so an always-mounted feed refetches after the record is saved.
   */
  refreshKey?: string | null;
  /** Reports how many entries are shown (null while nothing is loaded). */
  onEntryCountChange?: (count: number | null) => void;
};

/**
 * The audit history of one entity: the upgrade prompt, the "not enabled"
 * prompt, loading, empty, or the entry cards. Rendered by the drawer and by
 * the document side panel's Activity tab.
 */
export function AuditLogFeed({
  entityType,
  entityId,
  companyId,
  recordId,
  planRestricted = false,
  isActive,
  refreshKey,
  onEntryCountChange
}: AuditLogFeedProps) {
  const fetcher = useFetcher<AuditLogFetcherData>();
  // Held in a ref so a re-render (a new fetcher object) never re-runs the
  // load effect and cancels its delayed second look.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const entityKey = `${entityType}:${entityId}:${companyId}:${recordId ?? ""}`;
  const loadKey = `${entityKey}:${refreshKey ?? ""}`;
  const lastLoadedRef = useRef<string | null>(null);
  const requestedEntityRef = useRef<string | null>(null);
  // The entity the fetched entries belong to, so another record's history is
  // never shown while this one's loads.
  const [dataEntity, setDataEntity] = useState<string | null>(null);

  const rootRouteData = useRouteData<{ auditLogEnabled: Promise<boolean> }>(
    path.to.authenticatedRoot
  );
  const auditLogEnabled = useResolved(rootRouteData?.auditLogEnabled, false);
  const { can } = usePermissions();
  // /api/audit-log requires settings view and answers anyone else with a
  // redirect, which a fetcher follows — off the page the user is on.
  const canViewHistory = can("view", "settings");

  useEffect(() => {
    if (
      planRestricted ||
      !auditLogEnabled ||
      !canViewHistory ||
      !isActive ||
      !entityType ||
      !entityId ||
      lastLoadedRef.current === loadKey
    ) {
      return;
    }
    lastLoadedRef.current = loadKey;
    const params = new URLSearchParams({ entityType, entityId, companyId });
    if (recordId) params.set("recordId", recordId);
    const load = () => {
      requestedEntityRef.current = entityKey;
      fetcherRef.current.load(`/api/audit-log?${params.toString()}`);
    };
    load();
    // Audit rows are written by the event queue a few seconds after the
    // change itself, so look again once a save's entries have landed.
    const settle = setTimeout(load, AUDIT_SETTLE_MS);
    return () => clearTimeout(settle);
  }, [
    planRestricted,
    auditLogEnabled,
    canViewHistory,
    isActive,
    entityType,
    entityId,
    companyId,
    recordId,
    entityKey,
    loadKey
  ]);

  // Reset tracking when the feed goes inactive so it re-fetches next time
  useEffect(() => {
    if (!isActive) {
      lastLoadedRef.current = null;
    }
  }, [isActive]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setDataEntity(requestedEntityRef.current);
    }
  }, [fetcher.state, fetcher.data]);

  const hasCurrentData = Boolean(fetcher.data) && dataEntity === entityKey;
  const entries = hasCurrentData ? (fetcher.data?.entries ?? []) : [];
  const isLoading = !hasCurrentData;
  const shownCount =
    hasCurrentData && canViewHistory && !planRestricted && auditLogEnabled
      ? entries.length
      : null;

  useEffect(() => {
    onEntryCountChange?.(shownCount);
  }, [onEntryCountChange, shownCount]);

  if (!canViewHistory) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        <Trans>You don't have permission to view history.</Trans>
      </p>
    );
  }

  if (planRestricted) {
    return (
      <UpgradeOverlayInline>
        <UpgradeOverlayIcon>
          <LuHistory className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Upgrade to unlock audit history</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Track every change to your orders, invoices, customers, and more.
            </Trans>
          </UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </UpgradeOverlayInline>
    );
  }

  if (!auditLogEnabled) {
    return (
      <div className="flex flex-col items-center justify-start flex-1 w-full pt-[15dvh] text-center gap-4 px-4 h-full">
        <div className="rounded-full bg-muted p-3">
          <LuHistory className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">
            <Trans>Audit logging is not enabled</Trans>
          </h3>
          <p className="text-sm text-muted-foreground text-balance">
            <Trans>
              Enable audit logging in settings to start tracking changes to your
              data.
            </Trans>
          </p>
        </div>
        {can("update", "settings") ? (
          <Button variant="secondary" leftIcon={<LuSettings />} asChild>
            <Link to={path.to.auditLog}>
              <Trans>Enable in Settings</Trans>
            </Link>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">
            <Trans>
              Please contact your administrator to enable audit logging.
            </Trans>
          </span>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <VStack spacing={3}>
        <Skeleton className="w-full h-[151px]" />
        <Skeleton className="w-full h-[151px]" />
      </VStack>
    );
  }

  if (entries.length === 0) return <Empty className="py-12" />;

  return (
    <VStack spacing={3}>
      {entries.map((entry) => (
        <AuditLogEntryCard key={entry.id} entry={entry} />
      ))}
    </VStack>
  );
}

const AuditLogDrawer = memo(
  ({
    isOpen,
    onClose,
    entityType,
    entityId,
    companyId,
    title,
    recordId,
    planRestricted = false,
    downloadable = false,
    downloadName
  }: AuditLogDrawerProps) => {
    const [entryCount, setEntryCount] = useState<number | null>(null);
    const { download, isDownloading } = useAuditLogDownload({
      entityType,
      entityId,
      companyId,
      recordId,
      downloadName
    });

    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent size="lg" position="left">
          <DrawerHeader>
            <HStack className="justify-between pr-12">
              <DrawerTitle className="flex items-center gap-2">
                <LuHistory className="size-5" />
                {title ?? <Trans>History</Trans>}
              </DrawerTitle>
              {downloadable && (entryCount ?? 0) > 0 && (
                <Button
                  variant="secondary"
                  leftIcon={<LuDownload />}
                  isLoading={isDownloading}
                  isDisabled={isDownloading}
                  onClick={download}
                >
                  <Trans>Download</Trans>
                </Button>
              )}
            </HStack>
          </DrawerHeader>
          <DrawerBody>
            <AuditLogFeed
              entityType={entityType}
              entityId={entityId}
              companyId={companyId}
              recordId={recordId}
              planRestricted={planRestricted}
              isActive={isOpen}
              onEntryCountChange={downloadable ? setEntryCount : undefined}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    );
  }
);

AuditLogDrawer.displayName = "AuditLogDrawer";
export default AuditLogDrawer;

type AuditLogEntryCardProps = {
  entry: AuditLogEntry;
};

const AuditLogEntryCard = memo(({ entry }: AuditLogEntryCardProps) => {
  const opInfo = operationLabels[entry.operation] ?? {
    label: entry.operation,
    variant: "secondary" as const,
    icon: null
  };

  // Belt-and-suspenders filter — backend strips skipFields too, but if a
  // legacy entry slipped through (or a new skipField was added since the
  // entry was written), keep the noise out of the rendered diff.
  const diffKeys = entry.diff
    ? Object.keys(entry.diff).filter((k) => !isSkippedDiffKey(k))
    : [];

  return (
    <div className="border bg-muted/40 rounded-lg p-4 w-full">
      <HStack className="justify-between items-start mb-3">
        <VStack spacing={1}>
          {entry.actorId ? (
            <EmployeeAvatar employeeId={entry.actorId} />
          ) : (
            <span className="font-medium">
              <Trans>System</Trans>
            </span>
          )}
          <span
            className={cn(
              "text-xs text-muted-foreground",
              entry.actorId && "pl-8"
            )}
          >
            <DateTime value={entry.createdAt} variant="absolute" />
          </span>
        </VStack>
        <VStack spacing={1} className="items-end">
          <Badge variant={opInfo.variant} className="flex-shrink-0">
            <HStack className="gap-1">
              {opInfo.icon}
              <span>{opInfo.label}</span>
            </HStack>
          </Badge>
          <span className="text-xs text-muted-foreground">
            {getTableLabel(entry.tableName)}
          </span>
        </VStack>
      </HStack>

      <div className="mt-3 pt-3 border-t">
        <p className="text-sm font-medium mb-2">
          <Trans>Changes</Trans>
        </p>
        {diffKeys.length > 0 ? (
          <div className="space-y-1">
            {diffKeys.map((key) => (
              <ChangeRow key={key} columnKey={key} change={entry.diff![key]} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {entry.operation === "INSERT" ? (
              <Trans>New record created</Trans>
            ) : entry.operation === "DELETE" ? (
              <Trans>Record deleted</Trans>
            ) : (
              <Trans>No changes recorded</Trans>
            )}
          </p>
        )}
      </div>
    </div>
  );
});

AuditLogEntryCard.displayName = "AuditLogEntryCard";
export { AuditLogEntryCard };

// Hide globally-skipped columns (and any nested suffix path) from the
// rendered diff. Mirrors the writer/reader filter so vector / metadata
// noise stays out of the UI even if it sneaks past the API layer.
function isSkippedDiffKey(key: string): boolean {
  const skip = auditConfig.skipFields as readonly string[];
  for (let i = 0; i < skip.length; i++) {
    const s = skip[i]!;
    if (key === s || key.endsWith(`.${s}`)) return true;
  }
  return false;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

// Convert a column name into a Linear-style human label. When a snapshot
// exists, strip the trailing `Id` so a FK column reads as its referenced
// entity (e.g. `triggerProcessId` → `Trigger Process`). Without a
// snapshot, preserve the column name as-is so the raw column is still
// recognizable for forensic queries.
function humanizeColumnKey(key: string, hasSnapshot: boolean): string {
  const normalized = hasSnapshot && key.endsWith("Id") ? key.slice(0, -2) : key;
  return normalized
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// Raw "oldId → newId" transition for a multi-column snapshot header, or
// undefined when neither side is a string id.
function formatIdTransition(
  change: import("@carbon/database/audit.types").AuditDiffEntry
): string | undefined {
  if (typeof change.old !== "string" && typeof change.new !== "string") {
    return undefined;
  }
  const oldId = typeof change.old === "string" ? change.old : "—";
  const newId = typeof change.new === "string" ? change.new : "—";
  return `${oldId} → ${newId}`;
}

// Pick the snapshot value for a given snapshot column from old or new sides.
function snapshotValue(
  snapshot: Record<string, unknown> | undefined,
  col: string
): unknown {
  return snapshot && col in snapshot ? snapshot[col] : undefined;
}

// Wraps children in a styled tooltip carrying the raw id(s) — the forensic
// anchor behind a resolved display name. Instant-ish (root provider sets a
// 200ms delay), unlike the native `title` attribute which needs a ~1s
// motionless hover.
function IdTooltip({
  id,
  children
}: {
  id: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-xs">{id}</span>
      </TooltipContent>
    </Tooltip>
  );
}

// Linear-style pill: when a display value is present, show that as primary
// sans-serif text with the underlying raw value in a hover tooltip. When no
// display value is supplied, fall back to mono-rendering the raw value —
// appropriate for IDs, booleans, numbers.
function ChangePill({
  value,
  display,
  variant
}: {
  value: unknown;
  display?: unknown;
  variant: "old" | "new";
}) {
  // An empty-string display (e.g. a snapshot row whose name is blank) is no
  // display at all — fall through so an empty value renders the "Empty" pill
  // rather than a blank colored one.
  const hasDisplay =
    display !== undefined && display !== null && display !== "";
  if (!hasDisplay && isEmptyDiffValue(value)) {
    return (
      <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground italic">
        <Trans>Empty</Trans>
      </span>
    );
  }
  const text = hasDisplay ? formatValue(display) : formatValue(value);
  const className = cn(
    "px-2 py-0.5 rounded min-w-0 break-all",
    !hasDisplay && "font-mono",
    variant === "old"
      ? "bg-red-500/10 text-red-500"
      : "bg-green-500/10 text-green-500"
  );
  const tooltip = hasDisplay && typeof value === "string" ? value : undefined;
  const pill = <span className={className}>{text}</span>;
  if (!tooltip) return pill;
  return <IdTooltip id={tooltip}>{pill}</IdTooltip>;
}

// One labeled side-by-side row: "label  [old]  →  [new]". Used for both
// the top-level column rows and the indented sub-rows under a multi-field
// snapshot header.
function ChangeLine({
  label,
  oldValue,
  newValue,
  oldDisplay,
  newDisplay,
  indent
}: {
  label: string;
  oldValue: unknown;
  newValue: unknown;
  oldDisplay?: unknown;
  newDisplay?: unknown;
  indent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-sm py-1",
        indent && "pl-4"
      )}
    >
      <span className="text-muted-foreground font-medium min-w-[120px]">
        {label}
      </span>
      {oldValue !== undefined && (
        <ChangePill value={oldValue} display={oldDisplay} variant="old" />
      )}
      {oldValue !== undefined && newValue !== undefined && (
        <span className="text-muted-foreground">→</span>
      )}
      {newValue !== undefined && (
        <ChangePill value={newValue} display={newDisplay} variant="new" />
      )}
    </div>
  );
}

// Renders one row of the diff. Branches on snapshot key count:
//   • no snapshot       → raw column name + mono pill (numbers, booleans, ids)
//   • single-key snap   → humanized FK label + Linear pill (name primary,
//                         id on hover)
//   • multi-key snap    → humanized FK header + indented sub-rows per
//                         snapshot column, with the raw id shown last as a
//                         muted forensic anchor
export function ChangeRow({
  columnKey,
  change
}: {
  columnKey: string;
  change: import("@carbon/database/audit.types").AuditDiffEntry;
}) {
  const oldSnap = change.snapshot?.old;
  const newSnap = change.snapshot?.new;
  const snapKeys = new Set<string>([
    ...Object.keys(oldSnap ?? {}),
    ...Object.keys(newSnap ?? {})
  ]);
  const hasSnapshot = snapKeys.size > 0;
  const label = humanizeColumnKey(columnKey, hasSnapshot);

  // Path 1 — no snapshot. Same as before: one row, raw value pill.
  if (!hasSnapshot) {
    return (
      <ChangeLine label={label} oldValue={change.old} newValue={change.new} />
    );
  }

  // Path 2 — single snapshot column. Inline Linear pill, id on hover.
  if (snapKeys.size === 1) {
    const [col] = Array.from(snapKeys);
    return (
      <ChangeLine
        label={label}
        oldValue={change.old}
        newValue={change.new}
        oldDisplay={snapshotValue(oldSnap, col)}
        newDisplay={snapshotValue(newSnap, col)}
      />
    );
  }

  // Path 3 — multi-column snapshot. The snapshot fields disambiguate, so
  // the raw FK id is demoted to a hover tooltip on the section header —
  // Linear-style. Power users still see the id transition without crowding
  // the visual flow.
  const idTooltip = formatIdTransition(change);
  const header = (
    <div className="text-sm text-muted-foreground font-medium w-fit">
      {label}
    </div>
  );
  return (
    <div className="py-1">
      {idTooltip ? <IdTooltip id={idTooltip}>{header}</IdTooltip> : header}
      <div className="space-y-1 mt-1">
        {Array.from(snapKeys).map((col) => (
          <ChangeLine
            key={col}
            label={humanizeColumnKey(col, false)}
            oldValue={snapshotValue(oldSnap, col)}
            newValue={snapshotValue(newSnap, col)}
            indent
          />
        ))}
      </div>
    </div>
  );
}
