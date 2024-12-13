import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuEuro,
  LuGlobe,
  LuPencil,
  LuPhone,
  LuPrinter,
  LuStar,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { Customer, CustomerStatus } from "../../types";

type CustomersTableProps = {
  data: Customer[];
  count: number;
  customerStatuses: CustomerStatus[];
};

const CustomersTable = memo(
  ({ data, count, customerStatuses }: CustomersTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [people] = usePeople();
    const deleteModal = useDisclosure();
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
      null
    );

    const customColumns = useCustomColumns<Customer>("customer");
    const columns = useMemo<ColumnDef<Customer>[]>(() => {
      const defaultColumns: ColumnDef<Customer>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <div className="max-w-[320px] truncate">
              <Hyperlink to={path.to.customerDetails(row.original.id!)}>
                <CustomerAvatar customerId={row.original.id!} />
              </Hyperlink>
            </div>
          ),
          meta: {
            icon: <LuBookMarked />,
          },
        },
        {
          accessorKey: "status",
          header: "Customer Status",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: customerStatuses?.map((status) => ({
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
    }, [customerStatuses, people, customColumns]);

    const renderContextMenu = useMemo(
      // eslint-disable-next-line react/display-name
      () => (row: Customer) =>
        (
          <>
            <MenuItem onClick={() => navigate(path.to.customer(row.id!))}>
              <MenuIcon icon={<LuPencil />} />
              Edit
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                setSelectedCustomer(row);
                deleteModal.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete
            </MenuItem>
          </>
        ),
      [navigate, deleteModal, permissions]
    );

    return (
      <>
        <Table<Customer>
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
              table: "customer",
              label: "Customers",
            },
            {
              table: "customerContact",
              label: "Contacts",
            },
          ]}
          primaryAction={
            permissions.can("create", "sales") && (
              <New label="Customer" to={path.to.newCustomer} />
            )
          }
          renderContextMenu={renderContextMenu}
        />
        {selectedCustomer && selectedCustomer.id && (
          <ConfirmDelete
            action={path.to.deleteCustomer(selectedCustomer.id)}
            isOpen={deleteModal.isOpen}
            name={selectedCustomer.name!}
            text={`Are you sure you want to delete ${selectedCustomer.name!}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
              setSelectedCustomer(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelectedCustomer(null);
            }}
          />
        )}
      </>
    );
  }
);

CustomersTable.displayName = "CustomerTable";

export default CustomersTable;
