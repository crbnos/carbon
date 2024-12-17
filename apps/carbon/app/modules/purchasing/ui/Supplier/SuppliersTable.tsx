import { Badge, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuEuro,
  LuGlobe,
  LuPencil,
  LuPhone,
  LuPrinter,
  LuStar,
  LuTag,
  LuUser,
} from "react-icons/lu";
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
  tags: { name: string }[];
  supplierStatuses: SupplierStatus[];
};

const SuppliersTable = memo(
  ({ data, count, tags, supplierStatuses }: SuppliersTableProps) => {
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
          meta: {
            icon: <LuBookMarked />,
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
            icon: <LuStar />,
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
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "tags",
          header: "Tags",
          cell: ({ row }) => (
            <HStack spacing={0} className="gap-1">
              {row.original.tags?.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </HStack>
          ),
          meta: {
            filter: {
              type: "static",
              options: tags?.map((tag) => ({
                value: tag.name,
                label: <Badge variant="secondary">{tag.name}</Badge>,
              })),
              isArray: true,
            },
            icon: <LuTag />,
          },
        },
        // {
        //   id: "assignee",
        //   header: "Assignee",
        //   cell: ({ row }) => (
        //     <EmployeeAvatar employeeId={row.original.assignee} />
        //   ),
        //   meta: {
        //     filter: {
        //       type: "static",
        //       options: people.map((employee) => ({
        //         value: employee.id,
        //         label: employee.name,
        //       })),
        //     },
        //   },
        // },
        // {
        //   id: "orders",
        //   header: "Orders",
        //   cell: ({ row }) => (
        //     <Button variant="secondary" asChild>
        //       <Link
        //         to={`${path.to.purchaseOrders}?filter=supplierId:eq:${row.original.id}`}
        //       >
        //         {row.original.orderCount ?? 0} Orders
        //       </Link>
        //     </Button>
        //   ),
        // },

        {
          accessorKey: "currencyCode",
          header: "Currency",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuEuro />,
          },
        },
        {
          accessorKey: "phone",
          header: "Phone",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuPhone />,
          },
        },
        {
          accessorKey: "fax",
          header: "Fax",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuPrinter />,
          },
        },
        {
          accessorKey: "website",
          header: "Website",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuGlobe />,
          },
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
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
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
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "updatedAt",
          header: "Updated At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />,
          },
        },
      ];

      return [...defaultColumns, ...customColumns];
    }, [supplierStatuses, people, tags, customColumns]);

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
