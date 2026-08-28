import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendarClock,
  LuSquareUser,
  LuTruck,
  LuWrench
} from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { repairOrderStatusType } from "../../sales.models";
import { RepairOrderStatus } from "./RepairOrderStatus";

type RepairOrder = {
  id: string | null;
  repairOrderId: string | null;
  status: string | null;
  customerName: string | null;
  supplierName: string | null;
  orderDate: string | null;
  promisedDate: string | null;
  linesCount: number | null;
  linesAtSupplier: number | null;
  linesReceived: number | null;
  linesShipped: number | null;
};

type RepairOrdersTableProps = {
  data: RepairOrder[];
  count: number;
};

const RepairOrdersTable = memo(({ data, count }: RepairOrdersTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<RepairOrder>[]>(
    () => [
      {
        accessorKey: "repairOrderId",
        header: t`Repair Order`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.repairOrderDetails(row.original.id ?? "")}>
            {row.original.repairOrderId}
          </Hyperlink>
        ),
        meta: { icon: <LuWrench /> }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <RepairOrderStatus status={row.original.status} />,
        meta: {
          filter: {
            type: "static",
            options: repairOrderStatusType.map((status) => ({
              value: status,
              label: status
            }))
          },
          icon: <LuWrench />
        }
      },
      {
        accessorKey: "customerName",
        header: t`Customer`,
        cell: ({ row }) => row.original.customerName,
        meta: { icon: <LuSquareUser /> }
      },
      {
        id: "custody",
        header: t`Where`,
        // A one-line answer to "where are these units": the rollup the
        // repairOrders view computes per custody state.
        cell: ({ row }) => {
          const parts: string[] = [];
          if (row.original.linesReceived)
            parts.push(`${row.original.linesReceived} in shop`);
          if (row.original.linesAtSupplier)
            parts.push(`${row.original.linesAtSupplier} at supplier`);
          if (row.original.linesShipped)
            parts.push(`${row.original.linesShipped} shipped back`);
          return parts.length > 0 ? parts.join(" · ") : "—";
        },
        meta: { icon: <LuTruck /> }
      },
      {
        accessorKey: "supplierName",
        header: t`Repair Supplier`,
        cell: ({ row }) => (
          <Enumerable value={row.original.supplierName ?? "—"} />
        ),
        meta: { icon: <LuTruck /> }
      },
      {
        accessorKey: "orderDate",
        header: t`Opened`,
        cell: ({ row }) =>
          row.original.orderDate ? formatDate(row.original.orderDate) : "—",
        meta: { icon: <LuCalendarClock /> }
      },
      {
        accessorKey: "promisedDate",
        header: t`Promised`,
        cell: ({ row }) =>
          row.original.promisedDate
            ? formatDate(row.original.promisedDate)
            : "—",
        meta: { icon: <LuCalendarClock /> }
      }
    ],
    [t]
  );

  return (
    <Table<RepairOrder>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "sales") && (
          <New
            label={t`Repair Order`}
            to={`${path.to.newRepairOrder}?${params.toString()}`}
          />
        )
      }
      title={t`Repairs`}
    />
  );
});

RepairOrdersTable.displayName = "RepairOrdersTable";
export default RepairOrdersTable;
