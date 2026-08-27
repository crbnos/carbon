import { HStack, Status } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCircleGauge,
  LuClock,
  LuHash,
  LuTimer,
  LuUser,
  LuUserX
} from "react-icons/lu";
import { EmployeeAvatar, Table } from "~/components";
import { useDateFormatter } from "~/hooks";
import type { OnshapeSyncRun } from "../../types";
import {
  asOnshapeRunStatus,
  formatOnshapeSyncDuration,
  OnshapeRunStatusChip,
  useOnshapeSyncLabels
} from "../Item/OnshapeSyncPresentation";

type OnshapeSyncRunsTableProps = {
  data: OnshapeSyncRun[];
};

function countSkipped(run: OnshapeSyncRun): number {
  return (
    run.skippedAlreadySynced +
    run.skippedNoItem +
    run.skippedNonModel +
    run.skippedTooLarge
  );
}

function readDurationMs(run: OnshapeSyncRun): number | null {
  const startedAt = run.startedAt ?? run.createdAt;
  if (!run.finishedAt) return null;
  const duration = Date.parse(run.finishedAt) - Date.parse(startedAt);
  return Number.isNaN(duration) ? null : duration;
}

/** Every bulk sync this company has run, newest first, and how each one went. */
const OnshapeSyncRunsTable = memo(({ data }: OnshapeSyncRunsTableProps) => {
  const { t } = useLingui();
  const { formatDateTime } = useDateFormatter();
  const { runStatusLabel } = useOnshapeSyncLabels();

  const summarizeCounters = useCallback(
    (run: OnshapeSyncRun) =>
      [
        t`Scanned ${run.revisionsScanned}`,
        t`Synced ${run.synced}`,
        t`Skipped ${countSkipped(run)}`,
        t`Failed ${run.failed}`
      ].join(" · "),
    [t]
  );

  const columns = useMemo<ColumnDef<OnshapeSyncRun>[]>(() => {
    return [
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => {
          const status = asOnshapeRunStatus(row.original.status);
          return (
            <HStack spacing={2}>
              {status && <OnshapeRunStatusChip status={status} />}
              {status === "completed" && row.original.failed > 0 && (
                <Status color="red">{t`${row.original.failed} failed`}</Status>
              )}
            </HStack>
          );
        },
        meta: {
          icon: <LuCircleGauge />,
          exportValue: (row) => {
            const status = asOnshapeRunStatus(row.status);
            return status ? runStatusLabel(status) : null;
          }
        }
      },
      {
        accessorKey: "createdBy",
        header: t`Started by`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          icon: <LuUser />
        }
      },
      {
        accessorKey: "startedAt",
        header: t`Started`,
        cell: ({ row }) =>
          formatDateTime(row.original.startedAt ?? row.original.createdAt),
        meta: {
          icon: <LuClock />
        }
      },
      {
        accessorKey: "finishedAt",
        header: t`Finished`,
        cell: ({ row }) =>
          row.original.finishedAt ? (
            formatDateTime(row.original.finishedAt)
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        meta: {
          icon: <LuClock />
        }
      },
      {
        id: "duration",
        header: t`Duration`,
        cell: ({ row }) => {
          const duration = readDurationMs(row.original);
          return duration === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">
              {formatOnshapeSyncDuration(duration)}
            </span>
          );
        },
        meta: {
          icon: <LuTimer />,
          filterHeader: t`Duration`,
          exportValue: (row) => {
            const duration = readDurationMs(row);
            return duration === null
              ? null
              : formatOnshapeSyncDuration(duration);
          }
        }
      },
      {
        id: "counters",
        header: t`Results`,
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {summarizeCounters(row.original)}
          </span>
        ),
        meta: {
          icon: <LuHash />,
          filterHeader: t`Results`,
          exportValue: (row) => summarizeCounters(row)
        }
      },
      {
        accessorKey: "cancelledBy",
        header: t`Cancelled by`,
        cell: ({ row }) =>
          row.original.cancelledBy ? (
            <EmployeeAvatar employeeId={row.original.cancelledBy} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        meta: {
          icon: <LuUserX />
        }
      }
    ];
  }, [formatDateTime, runStatusLabel, summarizeCounters, t]);

  return (
    <Table<OnshapeSyncRun>
      data={data}
      columns={columns}
      count={data.length}
      emptyState={
        <span className="text-sm text-muted-foreground">
          <Trans>No syncs have run yet</Trans>
        </span>
      }
      title={t`Runs`}
      withPagination={false}
      withSearch={false}
      // Column headers must not write `?sort=` into the URL: the run history is
      // the whole capped set held client-side, and the only server sort the
      // route runs is the item-state read, whose columns are not these.
      withSimpleSorting={false}
    />
  );
});

OnshapeSyncRunsTable.displayName = "OnshapeSyncRunsTable";
export default OnshapeSyncRunsTable;
