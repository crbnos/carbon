import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuFactory,
  LuHash,
  LuLayers,
  LuLoaderCircle,
  LuUsers
} from "react-icons/lu";
import { DateTime, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCustomColumns } from "~/hooks/useCustomColumns";
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
      title={t`Batches`}
    />
  );
});

BatchesTable.displayName = "BatchesTable";
export default BatchesTable;
