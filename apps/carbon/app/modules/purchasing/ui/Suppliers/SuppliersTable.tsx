import { Button, Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Link, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type {
  Supplier,
  SupplierStatus,
  SupplierType,
} from "~/modules/purchasing";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type SuppliersTableProps = {
  data: Supplier[];
  count: number;
  supplierTypes: Partial<SupplierType>[];
  supplierStatuses: SupplierStatus[];
};

const SuppliersTable = memo(
  ({ data, count, supplierStatuses, supplierTypes }: SuppliersTableProps) => {
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
            <Hyperlink to={path.to.supplierDetails(row.original.id!)}>
              {row.original.name}
            </Hyperlink>
          ),
        },

        {
          accessorKey: "type",
          header: "Supplier Type",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: supplierTypes?.map((type) => ({
                value: type.name ?? "",
                label: <Enumerable value={type.name ?? ""} />,
              })),
            },
          },
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
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
      ];

      return [...defaultColumns, ...customColumns];
    }, [people, supplierTypes, supplierStatuses, customColumns]);

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
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false,
          }}
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
