import { Badge } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBlocks,
  LuBookMarked,
  LuCalendar,
  LuClipboardCheck,
  LuHash,
  LuTruck
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { useDateFormatter, useUrlParams } from "~/hooks";
import {
  inspectionSourceDocuments,
  inspectionStatusType
} from "~/modules/quality/quality.models";
import type { Inspection } from "~/modules/quality/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { getInspectionStatusVariant } from "./InspectionStatus";

type InspectionsTableProps = {
  data: Inspection[];
  count: number;
};

function computeProgress(row: Inspection): {
  inspected: number;
  total: number;
} {
  // The list loader selects `inspectionSample(status)` as an array of
  // child rows; count the non-Pending ones.
  const samples: { status: string }[] =
    ((row as any).inspectionSample as { status: string }[]) ?? [];
  const inspected = samples.filter((s) => s.status !== "Pending").length;
  return { inspected, total: (row as any).sampleSize ?? 0 };
}

const InspectionsTable = memo(({ data, count }: InspectionsTableProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const [params] = useUrlParams();
  const [items] = useItems();

  const columns = useMemo<ColumnDef<Inspection>[]>(() => {
    return [
      {
        accessorKey: "inspectionId",
        header: t`Inspection`,
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.inspection(row.original.id!)}?${params.toString()}`}
          >
            {(row.original as any).inspectionId}
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
        accessorKey: "sourceDocument",
        header: t`Source`,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0 text-sm">
            <span>
              {(row.original as any).sourceDocumentReadableId ??
                (row.original as any).sourceDocument}
            </span>
            <span className="text-xs text-muted-foreground">
              {(row.original as any).supplier?.name ??
                (row.original as any).sourceDocument}
            </span>
          </div>
        ),
        meta: {
          icon: <LuTruck />,
          filter: {
            type: "static",
            options: inspectionSourceDocuments.map((source) => ({
              value: source,
              label: source
            }))
          },
          exportValue: (row) =>
            (row as any).sourceDocumentReadableId ??
            (row as any).sourceDocument ??
            null
        }
      },
      {
        accessorKey: "lotSize",
        header: t`Lot Size`,
        cell: ({ row }) => (
          <span className="text-sm">{(row.original as any).lotSize ?? 0}</span>
        ),
        meta: { icon: <LuBlocks /> }
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
          <Badge variant={getInspectionStatusVariant(row.original.status)}>
            {row.original.status}
          </Badge>
        ),
        meta: {
          icon: <LuClipboardCheck />,
          filter: {
            type: "static",
            options: inspectionStatusType.map((s) => ({
              value: s,
              label: <Badge variant={getInspectionStatusVariant(s)}>{s}</Badge>
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
        meta: { icon: <LuBlocks /> }
      },
      {
        accessorKey: "createdAt",
        header: t`Received At`,
        cell: ({ row }) =>
          row.original.createdAt ? formatDate(row.original.createdAt) : "",
        meta: { icon: <LuCalendar /> }
      }
    ];
  }, [items, t, params, formatDate]);

  return (
    <Table<Inspection>
      data={data}
      columns={columns}
      count={count ?? 0}
      title={t`Inspections`}
      table="inspection"
      withSavedView
    />
  );
});

InspectionsTable.displayName = "InspectionsTable";
export default InspectionsTable;
