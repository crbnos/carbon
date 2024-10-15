import { Button, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Link, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import {
  EmployeeAvatar,
  Hyperlink,
  New,
  SupplierAvatar,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Supplier, SupplierStatus } from "~/modules/purchasing";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type SuppliersTableProps = {
  data: Supplier[];
  count: number;
  supplierStatuses: SupplierStatus[];
};

const SuppliersTable = memo(
  ({ data, count, supplierStatuses }: SuppliersTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [people] = usePeople();

    const customColumns = useCustomColumns<Supplier>("supplier");
    const columns = useMemo<ColumnDef<Supplier>[]>(() => {
      const defaultColumns: ColumnDef<Supplier>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <div className="max-w-[320px] truncate">
              <Hyperlink to={path.to.supplierDetails(row.original.id!)}>
                <SupplierAvatar supplierId={row.original.id!} />
              </Hyperlink>
            </div>
          ),
        },
        {
          accessorKey: "status",
          header: "Supplier Status",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: supplierStatuses?.map((status) => ({
                value: status.name,
                label: <Enumerable value={status.name ?? ""} />,
              })),
            },
          },
        },
        {
          id: "accountManagerId",
          header: "Account Manager",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.accountManagerId} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          id: "assignee",
          header: "Assignee",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.assignee} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          id: "orders",
          header: "Orders",
          cell: ({ row }) => (
            <Button variant="secondary" asChild>
              <Link
                to={`${path.to.purchaseOrders}?filter=supplierId:eq:${row.original.id}`}
              >
                {row.original.orderCount ?? 0} Orders
              </Link>
            </Button>
          ),
        },
        {
          id: "parts",
          header: "Parts",
          cell: ({ row }) => (
            <Button variant="secondary" asChild>
              <Link to={`${path.to.parts}?supplierId=${row.original.id}`}>
                {row.original.partCount ?? 0} Parts
              </Link>
            </Button>
          ),
        },
        {
          accessorKey: "currencyCode",
          header: "Currency",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "phone",
          header: "Phone",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "fax",
          header: "Fax",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "website",
          header: "Website",
          cell: (item) => item.getValue(),
        },
        {
          id: "createdBy",
          header: "Created By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
        {
          id: "updatedBy",
          header: "Updated By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name,
              })),
            },
          },
        },
        {
          accessorKey: "updatedAt",
          header: "Updated At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
      ];

      return [...defaultColumns, ...customColumns];
    }, [people, supplierStatuses, customColumns]);

    const renderContextMenu = useMemo(
      // eslint-disable-next-line react/display-name
      () => (row: Supplier) =>
        (
          <MenuItem onClick={() => navigate(path.to.supplier(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            Edit Supplier
          </MenuItem>
        ),
      [navigate]
    );

    return (
      <>
        <Table<Supplier>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["name"],
          }}
          defaultColumnVisibility={{
            currencyCode: false,
            phone: false,
            fax: false,
            website: false,
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false,
          }}
          importCSV={[
            {
              table: "supplier",
              label: "Suppliers",
            },
            {
              table: "supplierContact",
              label: "Contacts",
            },
          ]}
          primaryAction={
            permissions.can("create", "purchasing") && (
              <New label="Supplier" to={path.to.newSupplier} />
            )
          }
          renderContextMenu={renderContextMenu}
        />
      </>
    );
  }
);

SuppliersTable.displayName = "SupplierTable";

export default SuppliersTable;
