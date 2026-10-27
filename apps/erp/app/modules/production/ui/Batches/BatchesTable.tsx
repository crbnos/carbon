// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Status,
  toast
} from "@carbon/react";
import { BATCH_STATUS_COLOR_MAP } from "@carbon/utils";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCalendar,
  LuCirclePlay,
  LuEye,
  LuFactory,
  LuHash,
  LuLayers,
  LuLoaderCircle,
  LuTrash,
  LuUndo2,
  LuUsers
} from "react-icons/lu";
import { Link, useFetcher, useNavigate } from "react-router";
import { DateTime, Hyperlink, ItemThumbnail, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import type { BulkActionScope, InfiniteOptions } from "~/components/Table";
import { usePermissions } from "~/hooks";
import {
  useAllMatchingLimitLabel,
  useBulkStartToast
} from "~/hooks/useBulkAction";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { action as releaseBatchesAction } from "~/routes/x+/production+/batches.release";
import {
  bulkSelectionBody,
  isOverAllMatchingLimit
} from "~/utils/bulk-selection";
import { path } from "~/utils/path";
import { ALL_MATCHING_RELEASE_LIMIT } from "~/utils/table-jobs";
import { isBatchDissolvable, isBatchReleasable } from "../../production.models";
import type { JobOperationBatch } from "../../types";
import { BatchReleaseModal } from "./BatchReleaseModal";
import { BATCH_LIST_EXPORT_VALUES } from "./batch-list-export";
import { useBatchRelease } from "./useBatchRelease";

type BatchesTableProps = {
  data: JobOperationBatch[];
  count: number;
  infinite: InfiniteOptions;
};

const BATCH_STATUSES = [
  "Planned",
  "Active",
  "Completing",
  "Completed"
] as const;

// The ONE status → badge map for batches: the list, its filter options, and the
// detail drawer all render through it. Colors come from the shared
// BATCH_STATUS_COLOR_MAP (same source-of-truth convention as JobStatus), so a
// batch reads with the same color language as the jobs it dispatches. The stored
// `Active` value is DISPLAYED as "Released" (exactly like jobs display `Ready` as
// "Released"); `Planned` is the pre-floor state — composed, not yet dispatched.
export function BatchStatus({ status }: { status: string | null }) {
  if (!status) return null;
  const color =
    BATCH_STATUS_COLOR_MAP[status as keyof typeof BATCH_STATUS_COLOR_MAP];
  if (!color) return null;

  const displayText = status === "Active" ? "Released" : status;
  const tooltip = status === "Active" ? status : undefined;

  return (
    <Status color={color} tooltip={tooltip}>
      {displayText}
    </Status>
  );
}

// A function declaration on purpose: `plural()` nested in `t` inside a
// `memo(…)` component compiles to the global i18n, which is never activated
// (see .claude/rules/i18n-lingui-system.md).
function useBatchCountMessages() {
  const { t } = useLingui();
  return useMemo(
    () => ({
      release: (count: number) =>
        t`${plural(count, { one: "Release # batch", other: "Release # batches" })}`,
      released: (count: number) =>
        t`${plural(count, { one: "Released # batch", other: "Released # batches" })}`,
      dissolve: (count: number) =>
        t`${plural(count, { one: "Dissolve # batch", other: "Dissolve # batches" })}`,
      dissolved: (count: number) =>
        t`${plural(count, { one: "Dissolved # batch", other: "Dissolved # batches" })}`
    }),
    [t]
  );
}

const BatchesTable = memo(({ data, count, infinite }: BatchesTableProps) => {
  const { t } = useLingui();
  const countMessages = useBatchCountMessages();
  const showBulkStart = useBulkStartToast();
  const releaseLimitLabel = useAllMatchingLimitLabel(
    ALL_MATCHING_RELEASE_LIMIT
  );
  const permissions = usePermissions();
  const navigate = useNavigate();
  const canUpdate = permissions.can("update", "production");

  // Release (Planned → Active) / Unrelease (Active → Planned) post to the
  // batching action; a refusal lands in the toast.
  const { submit: submitBatchIntent } = useBatchRelease();
  // The row action opens the Release dialog (member-job checks + PO choice)
  // instead of releasing straight away.
  const [releaseTarget, setReleaseTarget] = useState<{
    id: string;
    readableId: string;
  } | null>(null);

  // "Delete" is the server fn's dissolve — offered while the batch is Planned or
  // Active (a started batch must be completed; Completed batches are history).
  const renderContextMenu = useCallback(
    (row: JobOperationBatch) => (
      <>
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.view}
          onClick={() => navigate(path.to.operationBatch(row.id))}
        >
          <MenuIcon icon={<LuEye />} />
          {t`View Batch`}
        </MenuItem>
        {row.status === "Planned" && (
          // No work-center gate: the scheduler auto-selects one (earliest
          // finish among the process's work centers) for a Released batch
          // that lacks it.
          <MenuItem
            disabled={!canUpdate}
            onClick={() =>
              setReleaseTarget({ id: row.id, readableId: row.readableId })
            }
          >
            <MenuIcon icon={<LuCirclePlay />} />
            {t`Release Batch`}
          </MenuItem>
        )}
        {row.status === "Active" && (
          <MenuItem
            disabled={!canUpdate}
            onClick={() => submitBatchIntent("unrelease", row.id)}
          >
            <MenuIcon icon={<LuUndo2 />} />
            {t`Unrelease Batch`}
          </MenuItem>
        )}
        <MenuItem
          destructive
          disabled={
            (row.status !== "Planned" && row.status !== "Active") || !canUpdate
          }
          onClick={() => navigate(path.to.deleteOperationBatch(row.id))}
        >
          <MenuIcon icon={<LuTrash />} />
          {t`Dissolve Batch`}
        </MenuItem>
      </>
    ),
    [navigate, canUpdate, submitBatchIntent, t]
  );

  // Bulk dissolve for the selected rows — Planned/Active batches only (a
  // started batch must be completed, not dissolved). Submits the ids to the
  // dissolve action; the fetcher revalidates the loader and we toast the
  // summary.
  const dissolveFetcher = useFetcher<{
    success?: boolean;
    message?: string;
    background?: boolean;
    dissolved?: number;
    failed?: { readableId: string; message: string }[];
  }>();
  const wasDissolving = useRef(false);
  useEffect(() => {
    if (dissolveFetcher.state !== "idle") {
      wasDissolving.current = true;
      return;
    }
    if (!wasDissolving.current) return;
    wasDissolving.current = false;
    const d = dissolveFetcher.data;
    if (!d || showBulkStart(d)) return;
    if (d.dissolved) {
      toast.success(countMessages.dissolved(d.dissolved));
    }
    if (d.failed?.length) {
      toast.error(
        t`Could not dissolve ${d.failed.length}: ${d.failed
          .map((f) => f.readableId)
          .join(", ")} — production already recorded`
      );
    }
  }, [
    dissolveFetcher.state,
    dissolveFetcher.data,
    t,
    countMessages,
    showBulkStart
  ]);

  // Bulk release for the selected rows — Planned batches only (release is the
  // Planned → Active flip; Active/Completing/Completed batches are already on or
  // off the floor). Posts the ids to the release action, which recalcs member
  // jobs, releases each, and notifies the scheduler; we toast the summary.
  const releaseBatchesFetcher = useAction<typeof releaseBatchesAction>({
    onSuccess: (result) => {
      if (showBulkStart(result)) return;
      const { data } = result;
      if (!data) return;
      if (data.released.length) {
        toast.success(countMessages.released(data.released.length));
      }
      if (data.failed.length) {
        toast.error(
          t`Could not release ${data.failed.length}: ${data.failed
            .map((f) => `${f.readableId} (${f.message})`)
            .join(", ")}`
        );
      }
    },
    onError: (result) => {
      if (showBulkStart(result)) return;
      if (result.error?.message) toast.error(result.error.message);
    }
  });

  const renderActions = useCallback(
    (selectedRows: JobOperationBatch[], scope?: BulkActionScope) => {
      const releasable = selectedRows.filter((r) =>
        isBatchReleasable(r.status)
      );
      const dissolvable = selectedRows.filter((r) =>
        isBatchDissolvable(r.status)
      );
      // Every matching row: the server picks the batches each action may act
      // on and skips the rest. Release runs on at most 2,000 of them.
      const allMatching = scope?.allMatching;
      const overReleaseLimit = isOverAllMatchingLimit(
        scope,
        ALL_MATCHING_RELEASE_LIMIT
      );
      return (
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel>
            <Trans>Actions</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={
              (!allMatching && releasable.length === 0) ||
              overReleaseLimit ||
              !canUpdate
            }
            onClick={() =>
              releaseBatchesFetcher.submit(
                bulkSelectionBody({
                  scope,
                  idsField: "batchIds",
                  ids: releasable.map((r) => r.id)
                }),
                {
                  method: "post",
                  action: path.to.releaseOperationBatches,
                  encType: "application/json"
                }
              )
            }
          >
            <DropdownMenuIcon icon={<LuCirclePlay />} />
            <div className="flex flex-col">
              {allMatching ? (
                <Trans>Release batches</Trans>
              ) : (
                countMessages.release(releasable.length)
              )}
              {overReleaseLimit && (
                <span className="text-xs text-muted-foreground">
                  {releaseLimitLabel}
                </span>
              )}
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            disabled={(!allMatching && dissolvable.length === 0) || !canUpdate}
            onClick={() =>
              dissolveFetcher.submit(
                bulkSelectionBody({
                  scope,
                  idsField: "batchIds",
                  ids: dissolvable.map((r) => r.id)
                }),
                {
                  method: "post",
                  action: path.to.dissolveOperationBatches,
                  encType: "application/json"
                }
              )
            }
          >
            <DropdownMenuIcon icon={<LuTrash />} />
            {allMatching ? (
              <Trans>Dissolve batches</Trans>
            ) : (
              countMessages.dissolve(dissolvable.length)
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      );
    },
    [
      canUpdate,
      dissolveFetcher,
      releaseBatchesFetcher,
      countMessages,
      releaseLimitLabel
    ]
  );

  const customColumns =
    useCustomColumns<JobOperationBatch>("jobOperationBatch");
  const columns = useMemo<ColumnDef<JobOperationBatch>[]>(() => {
    const defaultColumns: ColumnDef<JobOperationBatch>[] = [
      {
        accessorKey: "readableId",
        header: t`Batch`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id}>{row.original.readableId}</Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuLayers />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <BatchStatus status={row.original.status} />,
        meta: {
          mobile: "P2",
          filter: {
            type: "static",
            options: BATCH_STATUSES.map((status) => ({
              value: status,
              label: <BatchStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuLoaderCircle />
        }
      },
      {
        id: "process",
        header: t`Process`,
        cell: ({ row }) => (
          <Enumerable value={row.original.process?.name ?? null} />
        ),
        meta: {
          icon: <LuLayers />,
          filterHeader: t`Process`,
          exportValue: BATCH_LIST_EXPORT_VALUES.process
        }
      },
      {
        id: "workCenter",
        header: t`Work Center`,
        cell: ({ row }) => (
          <Enumerable value={row.original.workCenterName ?? null} />
        ),
        meta: {
          mobile: "P3",
          icon: <LuFactory />,
          filterHeader: t`Work Center`,
          exportValue: BATCH_LIST_EXPORT_VALUES.workCenter
        }
      },
      {
        accessorKey: "memberCount",
        header: t`Jobs`,
        // The loader counts the members per page: no column to sort on.
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.memberCount ?? 0}</span>
        ),
        meta: {
          mobile: "P2",
          mobileLabel: true,
          icon: <LuUsers />
        }
      },
      {
        accessorKey: "totalQuantity",
        header: t`Quantity`,
        // The loader sums the members per page: no column to sort on.
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.totalQuantity ?? 0}
          </span>
        ),
        meta: {
          icon: <LuHash />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: (item) => (
          <DateTime value={item.getValue<string>()} variant="date" />
        ),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "updatedAt",
        header: t`Last Activity`,
        cell: (item) => {
          const value = item.getValue<string | null>();
          return value ? <DateTime value={value} variant="date" /> : null;
        },
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, t]);

  // Only batches with members get a chevron.
  const canExpandRow = useCallback(
    (row: JobOperationBatch) => (row.members?.length ?? 0) > 0,
    []
  );

  // Expanding a batch reveals its member operations — job, item, quantity —
  // the same facts the detail drawer's member table shows (process, work
  // center and per-op status repeat for every member, so they add no info).
  const renderExpandedRow = useCallback(
    (row: JobOperationBatch) => {
      const members = row.members ?? [];
      if (members.length === 0) return null;
      return (
        <div className="pl-[52px] pr-4">
          {members.map((member) => (
            <div key={member.id} className="flex gap-3 py-3 text-sm">
              <div
                aria-hidden
                className="w-5 shrink-0 border-l border-border -my-3"
              />
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {member.jobId ? (
                  <Link
                    to={path.to.jobDetails(member.jobId)}
                    className="font-medium hover:underline"
                  >
                    {member.jobReadableId}
                  </Link>
                ) : (
                  <span className="font-medium">{member.jobReadableId}</span>
                )}
                <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <ItemThumbnail
                    thumbnailPath={member.thumbnailPath}
                    type="Part"
                    size="sm"
                  />
                  <span className="truncate">
                    {member.itemReadableId ?? "—"}
                    {member.itemName ? ` · ${member.itemName}` : ""}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="tabular-nums">
                  {member.quantityComplete}/{member.operationQuantity}
                </span>
                {member.quantityScrapped > 0 && (
                  <span className="ml-2 text-xs tabular-nums text-red-500">
                    {t`${member.quantityScrapped} scrapped`}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    },
    [t]
  );

  return (
    <>
      <Table<JobOperationBatch>
        data={data}
        columns={columns}
        count={count}
        infinite={infinite}
        primaryAction={
          permissions.can("create", "production") && (
            <New label={t`Batch`} to={path.to.newOperationBatch} />
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        renderExpandedRow={renderExpandedRow}
        canExpandRow={canExpandRow}
        withSelectableRows={canUpdate}
        getRowId={(row) => row.id}
        title={t`Batches`}
      />
      {releaseTarget && (
        <BatchReleaseModal
          target={{ batchId: releaseTarget.id }}
          title={t`Release batch ${releaseTarget.readableId}`}
          confirmLabel={t`Release Batch`}
          onClose={() => setReleaseTarget(null)}
          onConfirm={(purchaseOrders) => {
            submitBatchIntent("release", releaseTarget.id, purchaseOrders);
            setReleaseTarget(null);
          }}
        />
      )}
    </>
  );
});

BatchesTable.displayName = "BatchesTable";
export default BatchesTable;
