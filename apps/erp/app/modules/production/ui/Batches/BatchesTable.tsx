import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuEye,
  LuFactory,
  LuHash,
  LuLayers,
  LuLoaderCircle,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import { useNavigate } from "react-router";
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

const BATCH_STATUSES = ["Active", "Completing", "Completed"] as const;

function BatchStatus({ status }: { status: string | null }) {
  switch (status) {
    case "Completed":
      return <Badge variant="green">{status}</Badge>;
    case "Completing":
      return <Badge variant="yellow">{status}</Badge>;
    case "Active":
      return <Badge variant="secondary">{status}</Badge>;
    default:
      return null;
  }
}

const BatchesTable = memo(({ data, count }: BatchesTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();

  // "Delete" is the edge fn's dissolve — only offered while the batch is
  // Active (a started batch must be completed; Completed batches are history).
  const renderContextMenu = useCallback(
    (row: JobOperationBatch) => (
      <>
        <MenuItem onClick={() => navigate(path.to.operationBatch(row.id))}>
          <MenuIcon icon={<LuEye />} />
          {t`View Batch`}
        </MenuItem>
        <MenuItem
          disabled={
            row.status !== "Active" || !permissions.can("update", "production")
          }
          onClick={() => navigate(path.to.deleteOperationBatch(row.id))}
        >
          <MenuIcon icon={<LuTrash />} />
          {t`Dissolve Batch`}
        </MenuItem>
      </>
    ),
    [navigate, permissions, t]
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
      renderContextMenu={renderContextMenu}
      title={t`Batches`}
    />
  );
});

BatchesTable.displayName = "BatchesTable";
export default BatchesTable;
