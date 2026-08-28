import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendarClock,
  LuContainer,
  LuShieldCheck,
  LuSquareUser,
  LuTruck,
  LuWrench
} from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { path } from "~/utils/path";

// The generated view row — duplicating the shape here would drift the moment
// the view changes.
type WarrantyRegistration =
  Database["public"]["Views"]["warrantyRegistrations"]["Row"];

type WarrantyRegistrationsTableProps = {
  data: WarrantyRegistration[];
  count: number;
};

// "Active"/"Lifetime" are good news, "Expired" is not, and "Not Covered" is
// neutral — the colour has to carry that or the column is just noise.
const coverageStatus = (value: string | null) => {
  switch (value) {
    case "Active":
    case "Lifetime":
      return <Status color="green">{value}</Status>;
    case "Expired":
      return <Status color="red">{value}</Status>;
    default:
      return <Status color="gray">{value ?? "—"}</Status>;
  }
};

const WarrantyRegistrationsTable = memo(
  ({ data, count }: WarrantyRegistrationsTableProps) => {
    const { t } = useLingui();

    const columns = useMemo<ColumnDef<WarrantyRegistration>[]>(
      () => [
        {
          accessorKey: "warrantyRegistrationId",
          header: t`Registration`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.warrantyRegistration(row.original.id ?? "")}>
              {row.original.warrantyRegistrationId}
            </Hyperlink>
          ),
          meta: { icon: <LuShieldCheck /> }
        },
        {
          accessorKey: "itemReadableId",
          header: t`Item`,
          cell: ({ row }) => (
            <div className="flex flex-col">
              <span>{row.original.itemReadableId}</span>
              <span className="text-xs text-muted-foreground line-clamp-1">
                {row.original.itemName}
              </span>
            </div>
          ),
          meta: { icon: <LuContainer /> }
        },
        {
          accessorKey: "serialNumber",
          header: t`Serial / Batch`,
          cell: ({ row }) => row.original.serialNumber ?? "—",
          meta: { icon: <LuContainer /> }
        },
        {
          accessorKey: "customerName",
          header: t`Customer`,
          cell: ({ row }) => row.original.customerName,
          meta: { icon: <LuSquareUser /> }
        },
        {
          accessorKey: "startDate",
          header: t`Start`,
          cell: ({ row }) =>
            row.original.startDate ? formatDate(row.original.startDate) : "—",
          meta: { icon: <LuCalendarClock /> }
        },
        {
          accessorKey: "partsStatus",
          header: t`Parts`,
          cell: ({ row }) => coverageStatus(row.original.partsStatus),
          meta: { icon: <LuWrench /> }
        },
        {
          accessorKey: "partsExpirationDate",
          header: t`Parts Until`,
          cell: ({ row }) =>
            row.original.partsExpirationDate
              ? formatDate(row.original.partsExpirationDate)
              : "—",
          meta: { icon: <LuCalendarClock /> }
        },
        {
          accessorKey: "laborStatus",
          header: t`Labor`,
          cell: ({ row }) => coverageStatus(row.original.laborStatus),
          meta: { icon: <LuWrench /> }
        },
        {
          accessorKey: "laborExpirationDate",
          header: t`Labor Until`,
          cell: ({ row }) =>
            row.original.laborExpirationDate
              ? formatDate(row.original.laborExpirationDate)
              : "—",
          meta: { icon: <LuCalendarClock /> }
        },
        {
          accessorKey: "warrantyTermName",
          header: t`Term`,
          cell: ({ row }) => (
            <Enumerable value={row.original.warrantyTermName ?? "—"} />
          ),
          meta: { icon: <LuShieldCheck /> }
        },
        {
          accessorKey: "supplierName",
          header: t`Supplier Warranty`,
          cell: ({ row }) => row.original.supplierName ?? "—",
          meta: { icon: <LuTruck /> }
        },
        {
          accessorKey: "source",
          header: t`Source`,
          cell: ({ row }) => <Enumerable value={row.original.source ?? "—"} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "Shipment", label: t`Shipment` },
                { value: "Invoice", label: t`Invoice` },
                { value: "Repair", label: t`Repair` },
                { value: "Manual", label: t`Manual` }
              ]
            },
            icon: <LuTruck />
          }
        }
      ],
      [t]
    );

    return (
      <Table<WarrantyRegistration>
        data={data}
        columns={columns}
        count={count}
        title={t`Warranties`}
      />
    );
  }
);

WarrantyRegistrationsTable.displayName = "WarrantyRegistrationsTable";
export default WarrantyRegistrationsTable;
