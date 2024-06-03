import { Checkbox, Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Service } from "~/modules/parts";
import { serviceType } from "~/modules/parts";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type ServicesTableProps = {
  data: Service[];
  partGroups: ListItem[];
  count: number;
};

const ServicesTable = memo(
  ({ data, count, partGroups }: ServicesTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const customColumns = useCustomColumns<Service>("part");
    const [people] = usePeople();

    const columns = useMemo<ColumnDef<Service>[]>(() => {
      const defaultColumns: ColumnDef<Service>[] = [
        {
          accessorKey: "id",
          header: "Service ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.serviceDetails(row.original.itemId!)}>
              {row.original.id}
            </Hyperlink>
          ),
        },
        {
          accessorKey: "name",
          header: "Name",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "description",
          header: "Description",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "serviceType",
          header: "Service Type",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: serviceType.map((type) => ({
                value: type,
                label: <Enumerable value={type} />,
              })),
            },
          },
        },
        {
          accessorKey: "partGroup",
          header: "Part Group",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: partGroups.map(({ id, name }) => ({
                value: name,
                label: <Enumerable value={name} />,
              })),
            },
          },
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ],
            },
            pluralHeader: "Active Statuses",
          },
        },
        {
          accessorKey: "blocked",
          header: "Blocked",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Blocked" },
                { value: "false", label: "Not Blocked" },
              ],
            },
            pluralHeader: "Blocked Statuses",
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
    }, [customColumns, partGroups, people]);

    const renderContextMenu = useMemo(() => {
      // eslint-disable-next-line react/display-name
      return (row: Service) => (
        <MenuItem onClick={() => navigate(path.to.part(row.id!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit Service
        </MenuItem>
      );
    }, [navigate]);

    return (
      <>
        <Table<Service>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["id"],
          }}
          defaultColumnVisibility={{
            description: false,
            active: false,
            blocked: false,
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false,
          }}
          primaryAction={
            permissions.can("create", "parts") && (
              <New label="Service" to={path.to.newService} />
            )
          }
          renderContextMenu={renderContextMenu}
          withColumnOrdering
        />
      </>
    );
  }
);

ServicesTable.displayName = "ServiceTable";

export default ServicesTable;
