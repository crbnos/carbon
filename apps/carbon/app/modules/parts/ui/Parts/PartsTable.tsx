import { Checkbox, Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuPencil } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Part } from "~/modules/parts";
import { itemInventoryTypes, partReplenishmentSystems } from "~/modules/parts";
import { usePeople } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type PartsTableProps = {
  data: Part[];
  itemGroups: ListItem[];
  count: number;
};

const PartsTable = memo(({ data, count, itemGroups }: PartsTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const customColumns = useCustomColumns<Part>("part");
  const [people] = usePeople();

  const columns = useMemo<ColumnDef<Part>[]>(() => {
    const defaultColumns: ColumnDef<Part>[] = [
      {
        accessorKey: "id",
        header: "Part ID",
        cell: ({ row }) => (
          <Hyperlink to={path.to.partDetails(row.original.itemId!)}>
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
        accessorKey: "itemInventoryType",
        header: "Inventory",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: itemInventoryTypes.map((type) => ({
              value: type,
              label: <Enumerable value={type} />,
            })),
          },
        },
      },
      {
        accessorKey: "replenishmentSystem",
        header: "Replenishment",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: partReplenishmentSystems.map((type) => ({
              value: type,
              label: <Enumerable value={type} />,
            })),
          },
        },
      },
      {
        accessorKey: "itemGroup",
        header: "Posting Group",
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: itemGroups.map(({ name }) => ({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const renderContextMenu = useMemo(() => {
    // eslint-disable-next-line react/display-name
    return (row: Part) => (
      <MenuItem onClick={() => navigate(path.to.part(row.id!))}>
        <MenuIcon icon={<LuPencil />} />
        Edit Part
      </MenuItem>
    );
  }, [navigate]);

  return (
    <>
      <Table<Part>
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
            <New label="Part" to={path.to.newPart} />
          )
        }
        renderContextMenu={renderContextMenu}
        withColumnOrdering
      />
    </>
  );
});

PartsTable.displayName = "PartTable";

export default PartsTable;
