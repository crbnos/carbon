import {
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuIcon,
  MenuItem,
  Status,
  toast
} from "@carbon/react";
import { BATCH_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
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
import { useFetcher, useNavigate } from "react-router";
import { DateTime, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { JobOperationBatch } from "../../types";

type BatchesTableProps = {
  data: JobOperationBatch[];
  count: number;
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

const BatchesTable = memo(({ data, count }: BatchesTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const canUpdate = permissions.can("update", "production");

  // Release (Planned → Active) / Unrelease (Active → Planned) post to the
  // batching action; the server's refusal (no work center, production already
  // recorded) comes back as { success: false, message } and lands in the toast.
  const releaseFetcher = useFetcher<{
    success?: boolean;
    message?: string;
  }>();
  const wasReleasing = useRef(false);
  useEffect(() => {
    if (releaseFetcher.state !== "idle") {
      wasReleasing.current = true;
      return;
    }
    if (!wasReleasing.current) return;
    wasReleasing.current = false;
    const d = releaseFetcher.data;
    if (d?.success === false && d.message) {
      toast.error(d.message);
    }
  }, [releaseFetcher.state, releaseFetcher.data]);

  const submitBatchIntent = useCallback(
    (intent: "release" | "unrelease", batchId: string) => {
      releaseFetcher.submit(
        { intent, batchId },
        { method: "post", action: path.to.priorityBatchingUpdate }
      );
    },
    [releaseFetcher]
  );

  // "Delete" is the edge fn's dissolve — offered while the batch is Planned or
  // Active (a started batch must be completed; Completed batches are history).
  const renderContextMenu = useCallback(
    (row: JobOperationBatch) => (
      <>
        <MenuItem onClick={() => navigate(path.to.operationBatch(row.id))}>
          <MenuIcon icon={<LuEye />} />
          {t`View Batch`}
        </MenuItem>
        {row.status === "Planned" && (
          // No work-center gate: the scheduler auto-selects one (earliest
          // finish among the process's work centers) for a Released batch
          // that lacks it.
          <MenuItem
            disabled={!canUpdate}
            onClick={() => submitBatchIntent("release", row.id)}
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
    if (!d) return;
    if (d.success === false && d.message) {
      toast.error(d.message);
      return;
    }
    if (d.dissolved) toast.success(t`Dissolved ${d.dissolved} batches`);
    if (d.failed?.length) {
      toast.error(
        t`Could not dissolve ${d.failed.length}: ${d.failed
          .map((f) => f.readableId)
          .join(", ")} — production already recorded`
      );
    }
  }, [dissolveFetcher.state, dissolveFetcher.data, t]);

  const renderActions = useCallback(
    (selectedRows: JobOperationBatch[]) => {
      const dissolvable = selectedRows.filter(
        (r) => r.status === "Planned" || r.status === "Active"
      );
      return (
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel>
            <Trans>Actions</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            disabled={dissolvable.length === 0 || !canUpdate}
            onClick={() =>
              dissolveFetcher.submit(
                { batchIds: dissolvable.map((r) => r.id) },
                {
                  method: "post",
                  action: path.to.dissolveOperationBatches,
                  encType: "application/json"
                }
              )
            }
          >
            <DropdownMenuIcon icon={<LuTrash />} />
            {t`Dissolve ${dissolvable.length} batches`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      );
    },
    [canUpdate, dissolveFetcher, t]
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
          icon: <LuLayers />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <BatchStatus status={row.original.status} />,
        meta: {
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
          exportValue: (row: JobOperationBatch) => row.process?.name ?? null
        }
      },
      {
        id: "workCenter",
        header: t`Work Center`,
        cell: ({ row }) => (
          <Enumerable value={row.original.workCenterName ?? null} />
        ),
        meta: {
          icon: <LuFactory />,
          filterHeader: t`Work Center`,
          exportValue: (row: JobOperationBatch) => row.workCenterName ?? null
        }
      },
      {
        accessorKey: "memberCount",
        header: t`Jobs`,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.memberCount ?? 0}</span>
        ),
        meta: {
          icon: <LuUsers />
        }
      },
      {
        accessorKey: "totalQuantity",
        header: t`Quantity`,
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

  return (
    <Table<JobOperationBatch>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "production") && (
          <New label={t`Batch`} to={path.to.newOperationBatch} />
        )
      }
      renderActions={renderActions}
      renderContextMenu={renderContextMenu}
      withSelectableRows={canUpdate}
      getRowId={(row) => row.id}
      title={t`Batches`}
    />
  );
});

BatchesTable.displayName = "BatchesTable";
export default BatchesTable;
