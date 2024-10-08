import { Button, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useFetcher, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import { CustomerAvatar, EmployeeAvatar, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Customer, CustomerStatus } from "~/modules/sales";
import type { action } from "~/routes/api+/ai+/csv+/$table.columns";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type CustomersTableProps = {
  data: Customer[];
  count: number;
  customerStatuses: CustomerStatus[];
};

const CustomersTable = memo(
  ({ data, count, customerStatuses }: CustomersTableProps) => {
    const navigate = useNavigate();
    // const permissions = usePermissions();
    const [people] = usePeople();
    const fetcher = useFetcher<typeof action>();

    const letsGo = () => {
      fetcher.submit(
        {
          fieldColumns: [
            "ID",
            "Customer Name",
            "EIN",
            "Website",
            "Address",
            "City",
            "State",
            "Zip",
          ],
          firstRows: [
            {
              ID: "31294323",
              "Customer Name": "Acme Corp",
              EIN: "12-3456789",
              Website: "https://www.acmecorp.com",
              Address: "123 Main St",
              City: "Anytown",
              State: "CA",
              Zip: "12345",
            },
            {
              ID: "2324393",
              "Customer Name": "XYZ Industries",
              EIN: "98-7654321",
              Website: "https://www.xyzindustries.com",
              Address: "456 Oak Ave",
              City: "Somewhere",
              State: "NY",
              Zip: "67890",
            },
          ],
        },
        {
          method: "POST",
          action: path.to.api.generateCsvColumns("customer"),
          encType: "application/json",
        }
      );
    };

    console.log(fetcher);

    const customColumns = useCustomColumns<Customer>("customer");
    const columns = useMemo<ColumnDef<Customer>[]>(() => {
      const defaultColumns: ColumnDef<Customer>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <Hyperlink to={path.to.customerDetails(row.original.id!)}>
              <CustomerAvatar customerId={row.original.id!} />
            </Hyperlink>
          ),
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
    }, [customerStatuses, people, customColumns]);

    const renderContextMenu = useMemo(
      // eslint-disable-next-line react/display-name
      () => (row: Customer) =>
        (
          <MenuItem onClick={() => navigate(path.to.customer(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            Edit Customer
          </MenuItem>
        ),
      [navigate]
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
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false,
          }}
          primaryAction={
            // permissions.can("create", "sales") && (
            //   <New label="Customer" to={path.to.newCustomer} />
            // )
            <Button
              onClick={letsGo}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              Import
            </Button>
          }
          renderContextMenu={renderContextMenu}
        />
      </>
    );
  }
);

CustomersTable.displayName = "CustomerTable";

export default CustomersTable;
