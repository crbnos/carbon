import { Badge } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuClipboardCheck,
  LuHash,
  LuPackage,
  LuTruck
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { useDateFormatter, useUrlParams } from "~/hooks";
import { inboundInspectionStatus } from "~/modules/quality/quality.models";
import type { InboundInspection } from "~/modules/quality/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";

type InboundInspectionsTableProps = {
  data: InboundInspection[];
  count: number;
};

function getStatusVariant(status: string) {
  if (status === "Passed") return "green";
  if (status === "Failed") return "red";
  if (status === "Partial") return "yellow";
  if (status === "In Progress") return "blue";
  return "secondary";
}

function computeProgress(row: InboundInspection): {
  inspected: number;
  total: number;
} {
  // The list loader selects `inboundInspectionSample(status)` as an array of
  // child rows; count the non-Pending ones.
  const samples: { status: string }[] =
    ((row as any).inboundInspectionSample as { status: string }[]) ?? [];
  const inspected = samples.filter((s) => s.status !== "Pending").length;
  return { inspected, total: (row as any).sampleSize ?? 0 };
}

const InboundInspectionsTable = memo(
  ({ data, count }: InboundInspectionsTableProps) => {
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const [params] = useUrlParams();
    const [items] = useItems();

    const columns = useMemo<ColumnDef<InboundInspection>[]>(() => {
      return [
        {
          accessorKey: "inboundInspectionId",
          header: t`Inspection`,
          cell: ({ row }) => (
            <Hyperlink
              to={`${path.to.inboundInspection(row.original.id!)}?${params.toString()}`}
            >
              {(row.original as any).inboundInspectionId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "itemId",
          header: t`Item`,
          cell: ({ row }) => (
            <div className="flex flex-col gap-0">
              <span className="text-sm font-medium">
                {getItemReadableId(items, (row.original as any).itemId) ??
                  (row.original as any).itemReadableId ??
                  ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {(row.original as any).item?.name}
              </span>
            </div>
          ),
          meta: {
            icon: <LuBookMarked />,
            filter: {
              type: "static",
              options: items.map((item) => ({
                value: item.id,
                label: item.readableIdWithRevision
              }))
            }
          }
        },
        {
          id: "receipt",
          header: t`Receipt`,
          cell: ({ row }) => (
            <div className="flex flex-col gap-0 text-sm">
              <span>{(row.original as any).receipt?.receiptId}</span>
              <span className="text-xs text-muted-foreground">
                {(row.original as any).supplier?.name}
              </span>
            </div>
          ),
          meta: { icon: <LuTruck /> }
        },
        {
          accessorKey: "lotSize",
          header: t`Lot Size`,
          cell: ({ row }) => (
            <span className="text-sm">
              {(row.original as any).lotSize ?? 0}
            </span>
          ),
          meta: { icon: <LuPackage /> }
        },
        {
          accessorKey: "sampleSize",
          header: t`Sample`,
          cell: ({ row }) => {
            const p = computeProgress(row.original);
            return (
              <span className="text-sm">
                {p.inspected} / {p.total}
              </span>
            );
          },
          meta: { icon: <LuHash /> }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <Badge variant={getStatusVariant(row.original.status)}>
              {row.original.status}
            </Badge>
          ),
          meta: {
            icon: <LuClipboardCheck />,
            filter: {
              type: "static",
              options: inboundInspectionStatus.map((s) => ({
                value: s,
                label: <Badge variant={getStatusVariant(s)}>{s}</Badge>
              }))
            }
          }
        },
        {
          accessorKey: "createdBy",
          header: t`Received By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: { icon: <LuPackage /> }
        },
        {
          accessorKey: "createdAt",
          header: t`Received At`,
          cell: ({ row }) =>
            row.original.createdAt ? formatDate(row.original.createdAt) : "",
          meta: { icon: <LuCalendar /> }
        }
      ];
    }, [items, t, params]);

    return (
      <Table<InboundInspection>
        data={data}
        columns={columns}
        count={count ?? 0}
        title={t`Inbound Inspections`}
        table="inboundInspection"
        withSavedView
      />
    );
  }
);

InboundInspectionsTable.displayName = "InboundInspectionsTable";
export default InboundInspectionsTable;
