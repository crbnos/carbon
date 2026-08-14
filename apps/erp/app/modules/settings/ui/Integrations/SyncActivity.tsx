import {
  Badge,
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  IconButton,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import {
  LuArrowDownLeft,
  LuArrowUpRight,
  LuChevronLeft,
  LuChevronRight,
  LuCircleSlash,
  LuRefreshCw,
  LuRotateCw,
  LuScale,
  LuSend,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useRevalidator } from "react-router";
import { useDateFormatter, usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

/**
 * Local structural mirrors of @carbon/ee/accounting's SyncOperation /
 * SyncOperationStatus. Deliberately NOT imported (even type-only): this
 * component is re-exported through the ~/modules/settings barrel, and a
 * type edge from that barrel into @carbon/ee/accounting pushes unrelated
 * supabase select-string parses over TS2589's instantiation-depth limit
 * (usePurchaseInvoiceAutoFill). The route's loader passes real
 * SyncOperation rows, so any drift from the real shape fails typecheck at
 * that call site.
 */
export type SyncOperationStatus =
  | "Pending"
  | "In Flight"
  | "Completed"
  | "Failed"
  | "Warning"
  | "Skipped"
  | "Excluded";

export type SyncActivityOperation = {
  id: string;
  companyId: string;
  integration: string;
  entityType: string;
  entityId: string;
  direction: "push-to-accounting" | "pull-from-accounting";
  trigger: string;
  status: SyncOperationStatus;
  idempotencyKey: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  externalId: string | null;
  metadata: Record<string, unknown> | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

/**
 * Structural mirror of the reconciliation cron's drift entries
 * (@carbon/jobs accounting-reconciliation.ts), stored by the weekly cron at
 * companyIntegration.metadata.settings.postingSync.lastReconciliation.
 * Kept local for the same TS2589 reason as the operation types above.
 */
export type SyncReconciliationDriftEntry =
  | {
      type: "missing";
      externalId: string;
      journalId: string;
      amount?: number;
    }
  | {
      type: "mismatch";
      month: string;
      carbonTotal: number;
      providerTotal: number;
    };

export type SyncReconciliationReport = {
  runAt: string;
  drift: SyncReconciliationDriftEntry[];
};

type SyncActivityProps = {
  /** Shared tab bar, rendered at the top of this tab's body card. */
  tabs?: ReactNode;
  operations: SyncActivityOperation[];
  count: number;
  status: SyncOperationStatus | null;
  page: number;
  pageSize: number;
  /**
   * Latest reconciliation report from the integration's metadata
   * (settings.postingSync.lastReconciliation). Rendered as a warning
   * banner + drift table above the operations when drift exists.
   */
  lastReconciliation?: SyncReconciliationReport | null;
  /**
   * Tie-out summary for this integration (accountingSyncTieOut): latest
   * computedAt + how many period × account cells carry a nonzero internal
   * or external delta. Null / undefined = no tie-out rows exist yet, and
   * the card renders nothing.
   */
  tieOut?: {
    computedAt: string | null;
    deltaCellCount: number;
    cellCount: number;
  } | null;
};

const STATUS_FILTERS: SyncOperationStatus[] = [
  "Pending",
  "In Flight",
  "Completed",
  "Failed",
  "Warning",
  "Skipped",
  "Excluded"
];

const STATUS_COLORS: Record<
  SyncOperationStatus,
  "yellow" | "blue" | "green" | "red" | "orange" | "gray"
> = {
  Pending: "yellow",
  "In Flight": "blue",
  Completed: "green",
  Failed: "red",
  Warning: "orange",
  Skipped: "gray",
  Excluded: "gray"
};

/**
 * Display labels for sync entity types (keys of the accounting sync engine's
 * ENTITY_DEFINITIONS). Kept local so this client component doesn't import
 * runtime code from @carbon/ee/accounting.
 */
const ENTITY_LABELS: Record<string, string> = {
  customer: "Customer",
  vendor: "Vendor",
  item: "Item",
  employee: "Employee",
  purchaseOrder: "Purchase Order",
  bill: "Bill",
  salesOrder: "Sales Order",
  invoice: "Invoice",
  payment: "Payment",
  inventoryAdjustment: "Inventory Adjustment",
  journalEntry: "Journal Entry"
};

/**
 * Entity types that have a route helper. Everything else (payments, journal
 * entries, pulled records keyed by remote ids) renders as plain text.
 */
const ENTITY_PATHS: Record<string, (id: string) => string> = {
  customer: path.to.customer,
  vendor: path.to.supplier,
  item: path.to.part,
  employee: path.to.employeeAccount,
  purchaseOrder: path.to.purchaseOrder,
  bill: path.to.purchaseInvoice,
  salesOrder: path.to.salesOrder,
  invoice: path.to.salesInvoice
};

function getEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

function getEntityPath(operation: SyncActivityOperation): string | null {
  const pathFn = ENTITY_PATHS[operation.entityType];
  return pathFn ? pathFn(operation.entityId) : null;
}

function formatTrigger(trigger: string): string {
  return trigger.charAt(0).toUpperCase() + trigger.slice(1);
}

/**
 * UI actions by status (mirrors the service's transition guard):
 * Retry (Failed/Warning/Skipped → Pending — Skipped covers both a human
 * opt-out and the drain's machine no-op close, either of which a user may
 * re-drive), Skip (Failed/Warning/Pending → Skipped), Re-send
 * (Completed/Excluded → Pending — an Excluded journal re-decides against
 * the current posting-policy config).
 */
function getAvailableTransitions(status: SyncOperationStatus): {
  retry: boolean;
  skip: boolean;
  resend: boolean;
} {
  return {
    retry: status === "Failed" || status === "Warning" || status === "Skipped",
    skip: status === "Failed" || status === "Warning" || status === "Pending",
    resend: status === "Completed" || status === "Excluded"
  };
}

export function SyncActivity({
  tabs,
  operations,
  count,
  status,
  page,
  pageSize,
  lastReconciliation,
  tieOut
}: SyncActivityProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");
  const { formatRelativeTime } = useDateFormatter();
  const [, setParams] = useUrlParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetcher = useFetcher();
  const isTransitioning = fetcher.state !== "idle";

  // The tab's data (operations, tie-out, reconciliation) lives in the
  // route loader, so a manual refresh re-runs the loader in place.
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === "loading";

  const submitTransition = useCallback(
    (ids: string[], to: "Pending" | "Skipped") => {
      if (ids.length === 0) return;
      const formData = new FormData();
      formData.append("intent", "transition-sync-operation");
      formData.append("to", to);
      for (const id of ids) {
        formData.append("ids", id);
      }
      fetcher.submit(formData, { method: "post" });
    },
    [fetcher]
  );

  const setStatusFilter = useCallback(
    (nextStatus: SyncOperationStatus | null) => {
      setParams({
        syncStatus: nextStatus ?? undefined,
        syncPage: undefined
      });
    },
    [setParams]
  );

  const setPage = useCallback(
    (nextPage: number) => {
      setParams({
        syncPage: nextPage > 1 ? String(nextPage) : undefined
      });
    },
    [setParams]
  );

  // Keep the detail drawer in sync with revalidated data: after a
  // transition the row's status updates (or the row leaves the current
  // filter, closing the drawer).
  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedId) ?? null,
    [operations, selectedId]
  );

  const retryableIds = useMemo(
    () =>
      operations
        .filter(
          (operation) =>
            operation.status === "Failed" || operation.status === "Warning"
        )
        .map((operation) => operation.id),
    [operations]
  );

  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(count, (page - 1) * pageSize + operations.length);

  return (
    <>
      <DrawerBody className="gap-4">
        {tabs}
        <ReconciliationDrift lastReconciliation={lastReconciliation} />
        <TieOutSummary tieOut={tieOut} />

        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant={status === null ? "active" : "ghost"}
              onClick={() => setStatusFilter(null)}
            >
              <Trans>All</Trans>
            </Button>
            {STATUS_FILTERS.map((filter) => (
              <Button
                key={filter}
                size="sm"
                variant={status === filter ? "active" : "ghost"}
                onClick={() => setStatusFilter(filter)}
              >
                {filter}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {(status === "Failed" || status === "Warning") &&
              retryableIds.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<LuRotateCw />}
                  isDisabled={!canUpdate || isTransitioning}
                  onClick={() => submitTransition(retryableIds, "Pending")}
                >
                  <Trans>Retry all</Trans>
                </Button>
              )}
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label={t`Refresh`}
                  icon={
                    <LuRefreshCw
                      className={cn(isRefreshing && "animate-spin")}
                    />
                  }
                  variant="secondary"
                  size="sm"
                  isDisabled={isRefreshing}
                  onClick={() => revalidator.revalidate()}
                />
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Refresh</Trans>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="w-full rounded-lg border border-border">
          {operations.length === 0 ? (
            <div className="flex w-full items-center justify-center py-16 text-sm text-muted-foreground">
              {status ? (
                <Trans>No {status.toLowerCase()} sync operations</Trans>
              ) : (
                <Trans>No sync operations yet</Trans>
              )}
            </div>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="px-4">
                    <Trans>Status</Trans>
                  </Th>
                  <Th className="px-4 w-full">
                    <Trans>Entity</Trans>
                  </Th>
                  <Th className="px-4">
                    <Trans>Direction</Trans>
                  </Th>
                  <Th className="px-4">
                    <Trans>Trigger</Trans>
                  </Th>
                  <Th className="px-4 text-right">
                    <Trans>Attempts</Trans>
                  </Th>
                  <Th className="px-4">
                    <Trans>Last Attempt</Trans>
                  </Th>
                  <Th className="px-4">
                    <Trans>Error</Trans>
                  </Th>
                  <Th className="px-4" />
                </Tr>
              </Thead>
              <Tbody>
                {operations.map((operation) => {
                  const transitions = getAvailableTransitions(operation.status);
                  const entityPath = getEntityPath(operation);
                  return (
                    <Tr
                      key={operation.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedId(operation.id)}
                    >
                      <Td className="px-4">
                        <Status color={STATUS_COLORS[operation.status]}>
                          {operation.status}
                        </Status>
                      </Td>
                      <Td className="px-4">
                        <div className="flex flex-col py-1">
                          <span className="text-sm font-medium">
                            {getEntityLabel(operation.entityType)}
                          </span>
                          {entityPath ? (
                            <Link
                              to={entityPath}
                              prefetch="intent"
                              onClick={(e) => e.stopPropagation()}
                              className="block max-w-[180px] truncate font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                              {operation.entityId}
                            </Link>
                          ) : (
                            <span className="block max-w-[180px] truncate font-mono text-xs text-muted-foreground">
                              {operation.entityId}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td className="px-4">
                        <div className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                          {operation.direction === "push-to-accounting" ? (
                            <LuArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <LuArrowDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          {operation.direction === "push-to-accounting" ? (
                            <Trans>Push</Trans>
                          ) : (
                            <Trans>Pull</Trans>
                          )}
                        </div>
                      </Td>
                      <Td className="px-4 whitespace-nowrap text-sm">
                        {formatTrigger(operation.trigger)}
                      </Td>
                      <Td className="px-4 text-right text-sm tabular-nums">
                        {operation.attemptCount}
                      </Td>
                      <Td className="px-4 whitespace-nowrap text-sm text-muted-foreground">
                        {operation.lastAttemptAt
                          ? formatRelativeTime(operation.lastAttemptAt)
                          : "–"}
                      </Td>
                      <Td className="px-4">
                        {operation.errorMessage ? (
                          <span
                            className="block max-w-[200px] truncate text-xs text-muted-foreground"
                            title={operation.errorMessage}
                          >
                            {operation.errorMessage}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            –
                          </span>
                        )}
                      </Td>
                      <Td className="px-4" onClick={(e) => e.stopPropagation()}>
                        <HStack className="justify-end gap-0.5">
                          {transitions.retry && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <IconButton
                                  aria-label={t`Retry`}
                                  icon={<LuRotateCw />}
                                  variant="ghost"
                                  size="sm"
                                  isDisabled={!canUpdate || isTransitioning}
                                  onClick={() =>
                                    submitTransition([operation.id], "Pending")
                                  }
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <Trans>Retry</Trans>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {transitions.resend && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <IconButton
                                  aria-label={t`Re-send`}
                                  icon={<LuSend />}
                                  variant="ghost"
                                  size="sm"
                                  isDisabled={!canUpdate || isTransitioning}
                                  onClick={() =>
                                    submitTransition([operation.id], "Pending")
                                  }
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <Trans>Re-send</Trans>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {transitions.skip && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <IconButton
                                  aria-label={t`Skip`}
                                  icon={<LuCircleSlash />}
                                  variant="ghost"
                                  size="sm"
                                  isDisabled={!canUpdate || isTransitioning}
                                  onClick={() =>
                                    submitTransition([operation.id], "Skipped")
                                  }
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <Trans>Skip</Trans>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </HStack>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </div>

        <div className="flex w-full items-center justify-between">
          <p className="text-xs text-muted-foreground tabular-nums">
            {count === 0 ? (
              <Trans>0 operations</Trans>
            ) : (
              <Trans>
                {from}–{to} of {count} operations
              </Trans>
            )}
          </p>
          <div className="flex items-center gap-1">
            <IconButton
              aria-label={t`Previous page`}
              variant="ghost"
              size="sm"
              icon={<LuChevronLeft />}
              isDisabled={page <= 1}
              onClick={() => setPage(page - 1)}
            />
            <IconButton
              aria-label={t`Next page`}
              variant="ghost"
              size="sm"
              icon={<LuChevronRight />}
              isDisabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            />
          </div>
        </div>
      </DrawerBody>

      <SyncOperationDetailDrawer
        operation={selectedOperation}
        canUpdate={canUpdate}
        isTransitioning={isTransitioning}
        onTransition={submitTransition}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}

const driftAmountFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/**
 * Warning banner + compact drift table for the latest weekly
 * reconciliation. Rendered above the operations table only when the stored
 * report has drift entries — a clean report (or none yet) shows nothing.
 */
/**
 * Compact tie-out status card, styled after the drift banner above it:
 * amber when any period × account cell carries a nonzero delta, quiet
 * otherwise. Links to the accounting module's tie-out page (which requires
 * accounting_view). Renders nothing when no tie-out rows exist.
 */
function TieOutSummary({
  tieOut
}: {
  tieOut?: {
    computedAt: string | null;
    deltaCellCount: number;
    cellCount: number;
  } | null;
}) {
  const { formatRelativeTime } = useDateFormatter();

  if (!tieOut) return null;
  const hasDeltas = tieOut.deltaCellCount > 0;

  return (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border p-4",
        hasDeltas ? "border-amber-500/40 bg-amber-500/5" : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        {hasDeltas ? (
          <LuTriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
        ) : (
          <LuScale className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            <Trans>Tie-out</Trans>
          </span>
          <span className="text-xs text-muted-foreground">
            {hasDeltas ? (
              <Trans>{tieOut.deltaCellCount} cells with deltas</Trans>
            ) : (
              <Trans>All {tieOut.cellCount} cells tie out</Trans>
            )}
            {tieOut.computedAt ? (
              <>
                {" · "}
                <Trans>computed {formatRelativeTime(tieOut.computedAt)}</Trans>
              </>
            ) : null}
          </span>
        </div>
      </div>
      <Button size="sm" variant="secondary" asChild>
        <Link to={path.to.accountingSyncTieOut}>
          <Trans>View tie-out</Trans>
        </Link>
      </Button>
    </div>
  );
}

function ReconciliationDrift({
  lastReconciliation
}: {
  lastReconciliation?: SyncReconciliationReport | null;
}) {
  const { formatDateTime } = useDateFormatter();

  const drift = lastReconciliation?.drift ?? [];
  if (!lastReconciliation || drift.length === 0) return null;

  const missingCount = drift.filter((entry) => entry.type === "missing").length;
  const mismatchCount = drift.length - missingCount;

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <LuTriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            <Trans>Reconciliation found discrepancies with the provider</Trans>
          </span>
          <span className="text-xs text-muted-foreground">
            {missingCount > 0 && mismatchCount > 0 ? (
              <Trans>
                {missingCount} missing journals and {mismatchCount} mismatched
                months
              </Trans>
            ) : missingCount > 0 ? (
              <Trans>{missingCount} journals missing in the provider</Trans>
            ) : (
              <Trans>{mismatchCount} months with mismatched totals</Trans>
            )}{" "}
            <Trans>
              — last checked {formatDateTime(lastReconciliation.runAt)}
            </Trans>
          </span>
        </div>
      </div>

      <div className="w-full overflow-x-auto rounded-lg border border-border bg-background">
        <Table>
          <Thead>
            <Tr>
              <Th className="px-4">
                <Trans>Type</Trans>
              </Th>
              <Th className="px-4 w-full">
                <Trans>Reference</Trans>
              </Th>
              <Th className="px-4 text-right">
                <Trans>Carbon</Trans>
              </Th>
              <Th className="px-4 text-right">
                <Trans>Provider</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {drift.map((entry, index) =>
              entry.type === "missing" ? (
                <Tr key={`missing-${entry.externalId}-${index}`}>
                  <Td className="px-4">
                    <Status color="orange">
                      <Trans>Missing</Trans>
                    </Status>
                  </Td>
                  <Td className="px-4">
                    <div className="flex flex-col py-1">
                      <span className="block max-w-[260px] truncate font-mono text-xs">
                        {entry.externalId}
                      </span>
                      <span className="block max-w-[260px] truncate font-mono text-xs text-muted-foreground">
                        {entry.journalId}
                      </span>
                    </div>
                  </Td>
                  <Td className="px-4 text-right text-sm tabular-nums">
                    {entry.amount != null
                      ? driftAmountFormatter.format(entry.amount)
                      : "–"}
                  </Td>
                  <Td className="px-4 text-right text-sm text-muted-foreground">
                    –
                  </Td>
                </Tr>
              ) : (
                <Tr key={`mismatch-${entry.month}-${index}`}>
                  <Td className="px-4">
                    <Status color="orange">
                      <Trans>Mismatch</Trans>
                    </Status>
                  </Td>
                  <Td className="px-4 text-sm">{entry.month}</Td>
                  <Td className="px-4 text-right text-sm tabular-nums">
                    {driftAmountFormatter.format(entry.carbonTotal)}
                  </Td>
                  <Td className="px-4 text-right text-sm tabular-nums">
                    {driftAmountFormatter.format(entry.providerTotal)}
                  </Td>
                </Tr>
              )
            )}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}

function Detail({
  label,
  children
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function SyncOperationDetailDrawer({
  operation,
  canUpdate,
  isTransitioning,
  onTransition,
  onClose
}: {
  operation: SyncActivityOperation | null;
  canUpdate: boolean;
  isTransitioning: boolean;
  onTransition: (ids: string[], to: "Pending" | "Skipped") => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { formatDateTime } = useDateFormatter();

  if (!operation) return null;

  const transitions = getAvailableTransitions(operation.status);
  const entityPath = getEntityPath(operation);
  const hasMetadata =
    operation.metadata && Object.keys(operation.metadata).length > 0;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="sm">
        <DrawerHeader>
          <DrawerTitle>
            {getEntityLabel(operation.entityType)}{" "}
            <span className="font-mono text-muted-foreground">
              {operation.entityId}
            </span>
          </DrawerTitle>
          <DrawerDescription>
            <Trans>Sync operation</Trans>{" "}
            <span className="font-mono">{operation.id}</span>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="gap-4">
          <div className="grid w-full grid-cols-2 gap-x-4 gap-y-3">
            <Detail label={t`Status`}>
              <Status color={STATUS_COLORS[operation.status]}>
                {operation.status}
              </Status>
            </Detail>
            <Detail label={t`Direction`}>
              {operation.direction === "push-to-accounting" ? (
                <Trans>Push to accounting</Trans>
              ) : (
                <Trans>Pull from accounting</Trans>
              )}
            </Detail>
            <Detail label={t`Trigger`}>
              {formatTrigger(operation.trigger)}
            </Detail>
            <Detail label={t`Attempts`}>
              <span className="tabular-nums">{operation.attemptCount}</span>
            </Detail>
            <Detail label={t`Last attempt`}>
              {operation.lastAttemptAt
                ? formatDateTime(operation.lastAttemptAt)
                : "–"}
            </Detail>
            <Detail label={t`Completed`}>
              {operation.completedAt
                ? formatDateTime(operation.completedAt)
                : "–"}
            </Detail>
            <Detail label={t`Created`}>
              {formatDateTime(operation.createdAt)}
            </Detail>
            <Detail label={t`External ID`}>
              {operation.externalId ? (
                <span className="break-all font-mono text-xs">
                  {operation.externalId}
                </span>
              ) : (
                "–"
              )}
            </Detail>
          </div>
          <Detail label={t`Entity`}>
            {entityPath ? (
              <Link
                to={entityPath}
                prefetch="intent"
                className="break-all font-mono text-xs hover:underline"
              >
                {operation.entityId}
              </Link>
            ) : (
              <span className="break-all font-mono text-xs">
                {operation.entityId}
              </span>
            )}
          </Detail>
          <Detail label={t`Idempotency key`}>
            <span className="break-all font-mono text-xs">
              {operation.idempotencyKey}
            </span>
          </Detail>
          {(operation.errorCode || operation.errorMessage) && (
            <div className="flex w-full flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              {operation.errorCode && (
                <Badge variant="destructive" className="self-start font-mono">
                  {operation.errorCode}
                </Badge>
              )}
              {operation.errorMessage && (
                <p className="whitespace-pre-wrap break-words text-sm">
                  {operation.errorMessage}
                </p>
              )}
            </div>
          )}
          {hasMetadata && (
            <div className="flex w-full flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                <Trans>Metadata</Trans>
              </span>
              <pre className="w-full overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
                {JSON.stringify(operation.metadata, null, 2)}
              </pre>
            </div>
          )}
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            {transitions.retry && (
              <Button
                leftIcon={<LuRotateCw />}
                isDisabled={!canUpdate || isTransitioning}
                onClick={() => onTransition([operation.id], "Pending")}
              >
                <Trans>Retry</Trans>
              </Button>
            )}
            {transitions.resend && (
              <Button
                leftIcon={<LuSend />}
                isDisabled={!canUpdate || isTransitioning}
                onClick={() => onTransition([operation.id], "Pending")}
              >
                <Trans>Re-send</Trans>
              </Button>
            )}
            {transitions.skip && (
              <Button
                variant="secondary"
                leftIcon={<LuCircleSlash />}
                isDisabled={!canUpdate || isTransitioning}
                onClick={() => onTransition([operation.id], "Skipped")}
              >
                <Trans>Skip</Trans>
              </Button>
            )}
            <Button variant="solid" onClick={onClose}>
              <Trans>Close</Trans>
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
